/**
 * Cliente de la API de Mercado Libre para la cuenta de VAL ARG.
 *
 * Responsabilidades:
 *   - Manejar el access_token: leerlo de MlCredential y refrescarlo cuando está
 *     vencido o por vencer (margen de 5 min). El refresh_token de ML es de UN
 *     SOLO USO: cada refresh devuelve uno nuevo que persistimos junto al access
 *     token. El refresh se serializa con un lock para evitar carreras (dos
 *     refresh concurrentes invalidarían el token).
 *   - Helpers tipados para los endpoints que usa la mensajería post-venta.
 *
 * Variables de entorno:
 *   ML_CLIENT_ID     — app id de la integración ML
 *   ML_CLIENT_SECRET — secret de la app
 *   ML_USER_ID       — id del seller (VAL ARG); se usa como fallback para
 *                      ubicar la credencial si hay una sola fila.
 *
 * Docs:
 *   https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion
 *   https://developers.mercadolibre.com.ar/es_ar/mensajeria-posventa
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

const ML_API = 'https://api.mercadolibre.com'
// Margen para refrescar antes de que venza de verdad.
const REFRESH_MARGIN_MS = 5 * 60 * 1000

// Lock en memoria para serializar refresh concurrentes dentro del proceso.
// Si llegan dos requests juntos, el segundo espera al primero y reusa el token.
let refreshInFlight: Promise<string> | null = null

interface MlTokenResponse {
  access_token: string
  token_type: string
  expires_in: number // segundos
  scope?: string
  user_id?: number
  refresh_token: string
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

function getCredentialWhere() {
  const envUserId = process.env.ML_USER_ID
  // Hay una sola fila (la cuenta de VAL ARG). Si está el env la usamos para
  // desambiguar; si no, tomamos la primera.
  return envUserId ? { mlUserId: BigInt(envUserId) } : undefined
}

async function loadCredential() {
  const where = getCredentialWhere()
  const cred = where
    ? await prisma.mlCredential.findUnique({ where })
    : await prisma.mlCredential.findFirst()
  if (!cred) {
    throw new Error(
      '[ML] No hay MlCredential cargada. Cargá la fila con el access/refresh token inicial.'
    )
  }
  return cred
}

/**
 * Devuelve un access_token válido, refrescándolo si hace falta.
 * El refresh se serializa con refreshInFlight y se persiste de forma atómica.
 */
export async function getValidAccessToken(): Promise<string> {
  const cred = await loadCredential()

  const valid = cred.expiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS
  if (valid) return cred.accessToken

  // Vencido o por vencer: refrescar (serializado).
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = refreshAccessToken(cred.id, cred.refreshToken).finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

async function refreshAccessToken(
  credentialId: string,
  refreshToken: string
): Promise<string> {
  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('[ML] Faltan ML_CLIENT_ID / ML_CLIENT_SECRET en el entorno.')
  }

  logger.info('[ML] Refrescando access_token...')

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  })

  const res = await fetch(`${ML_API}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`[ML] Refresh falló: HTTP ${res.status} ${detail}`)
  }

  const data = (await res.json()) as MlTokenResponse
  const expiresAt = new Date(Date.now() + data.expires_in * 1000)

  // CRÍTICO: persistir el refresh_token NUEVO (el viejo ya no sirve).
  // updateMany con el refreshToken viejo en el where actúa como guard contra
  // refresh concurrentes que pisen un token ya rotado.
  const updated = await prisma.mlCredential.updateMany({
    where: { id: credentialId, refreshToken },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    },
  })

  if (updated.count === 0) {
    // Otro proceso rotó el token antes que nosotros: releemos y devolvemos el
    // vigente en vez de pisarlo.
    logger.warn('[ML] Refresh ya aplicado por otro proceso; releyendo credencial.')
    const fresh = await prisma.mlCredential.findUnique({ where: { id: credentialId } })
    if (!fresh) throw new Error('[ML] Credencial desapareció durante el refresh.')
    return fresh.accessToken
  }

  logger.info(`[ML] access_token refrescado, vence ${expiresAt.toISOString()}`)
  return data.access_token
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function mlFetch<T>(
  path: string,
  init?: RequestInit & { method?: string }
): Promise<T> {
  const token = await getValidAccessToken()
  const res = await fetch(`${ML_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })

  const raw = await res.text()
  let parsed: unknown = null
  if (raw) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = raw
    }
  }

  if (!res.ok) {
    const err = new MlApiError(
      `[ML] ${init?.method ?? 'GET'} ${path} -> HTTP ${res.status}`,
      res.status,
      parsed
    )
    throw err
  }

  return parsed as T
}

export class MlApiError extends Error {
  status: number
  body: unknown
  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'MlApiError'
    this.status = status
    this.body = body
  }
}

// ---------------------------------------------------------------------------
// Tipos (parciales — solo lo que usamos)
// ---------------------------------------------------------------------------

export interface MlOrderItem {
  item: {
    id: string // ml_item_id, ej "MLA123456789"
    title?: string
    seller_sku?: string | null
    seller_custom_field?: string | null
  }
  quantity?: number
}

export interface MlOrder {
  id: number
  status: string // "paid", "cancelled", ...
  pack_id?: number | null
  order_items: MlOrderItem[]
  buyer?: { id?: number; nickname?: string }
}

export interface MlActionGuideCap {
  // ML expone las opciones disponibles del action_guide con su cupo restante.
  option_id?: string // ej "OTHER"
  id?: string
  cap_available?: number
}

export interface MlCapsResponse {
  // La respuesta trae la lista de caps; el shape exacto varía, contemplamos
  // ambas formas habituales.
  caps_available?: MlActionGuideCap[]
  options?: MlActionGuideCap[]
}

export interface MlPostOptionResponse {
  id?: string // id del mensaje creado
  message_id?: string
  status?: string
  moderation?: {
    status?: string // ej "rejected", "pending", "clean"
    reason?: string
    moderation_reason?: string
  }
}

// ---------------------------------------------------------------------------
// Helpers tipados
// ---------------------------------------------------------------------------

export function getOrder(orderId: string): Promise<MlOrder> {
  return mlFetch<MlOrder>(`/orders/${orderId}`)
}

export function getActionGuideCaps(packId: string): Promise<MlCapsResponse> {
  return mlFetch<MlCapsResponse>(
    `/messages/action_guide/packs/${packId}/caps_available?tag=post_sale`
  )
}

export function postActionGuideOption(
  packId: string,
  optionId: string,
  text: string,
  templateId?: string
): Promise<MlPostOptionResponse> {
  const body: Record<string, string> = { option_id: optionId, text }
  if (templateId) body.template_id = templateId
  return mlFetch<MlPostOptionResponse>(
    `/messages/action_guide/packs/${packId}/option?tag=post_sale`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    }
  )
}

// ---------------------------------------------------------------------------
// Preguntas pre-venta
// Docs: https://developers.mercadolibre.com.ar/es_ar/preguntas-y-respuestas
// ---------------------------------------------------------------------------

export interface MlQuestion {
  id: number
  text: string
  status: string // "UNANSWERED" | "ANSWERED" | "CLOSED_UNANSWERED" | "UNDER_REVIEW" | "BANNED" | "DELETED"
  item_id: string
  seller_id?: number
  date_created?: string
  from?: { id?: number }
  answer?: { text?: string; status?: string; date_created?: string } | null
}

export interface MlItem {
  id: string
  title: string
  price?: number
  currency_id?: string
  available_quantity?: number
  status?: string
  permalink?: string
  seller_custom_field?: string | null
  attributes?: { id: string; name?: string; value_name?: string | null }[]
  variations?: { seller_custom_field?: string | null; attributes?: { id: string; value_name?: string | null }[] }[]
}

export interface MlItemDescription {
  plain_text?: string
}

export interface MlQuestionSearch {
  total?: number
  questions: MlQuestion[]
}

export function getQuestion(questionId: string | number): Promise<MlQuestion> {
  return mlFetch<MlQuestion>(`/questions/${questionId}?api_version=4`)
}

export function getItem(itemId: string): Promise<MlItem> {
  return mlFetch<MlItem>(
    `/items/${itemId}?attributes=id,title,price,currency_id,available_quantity,status,permalink,seller_custom_field,attributes,variations`
  )
}

export function getItemDescription(itemId: string): Promise<MlItemDescription> {
  return mlFetch<MlItemDescription>(`/items/${itemId}/description`)
}

/** Preguntas ya respondidas del ítem (sirven de ejemplos para la IA). */
export function getItemAnsweredQuestions(itemId: string, limit = 15): Promise<MlQuestionSearch> {
  return mlFetch<MlQuestionSearch>(
    `/questions/search?item=${itemId}&status=ANSWERED&sort_fields=date_created&sort_types=DESC&limit=${limit}&api_version=4`
  )
}

/** Preguntas sin responder de toda la cuenta (para sincronizar/backfill). */
export function getMyUnansweredQuestions(limit = 50, offset = 0): Promise<MlQuestionSearch> {
  return mlFetch<MlQuestionSearch>(
    `/my/received_questions/search?status=UNANSWERED&limit=${limit}&offset=${offset}&api_version=4`
  )
}

export function postAnswer(questionId: string | number, text: string): Promise<unknown> {
  return mlFetch(`/answers`, {
    method: 'POST',
    body: JSON.stringify({ question_id: Number(questionId), text }),
  })
}

// ---------------------------------------------------------------------------
// Publicaciones / stock
// ---------------------------------------------------------------------------

/** user_id del seller: ML_USER_ID o el de la credencial cargada. */
export async function getMlUserId(): Promise<string> {
  if (process.env.ML_USER_ID) return process.env.ML_USER_ID
  const cred = await loadCredential()
  return cred.mlUserId.toString()
}

export interface MlItemsSearch {
  results: string[]
  paging?: { total: number; offset: number; limit: number }
}

/** IDs de publicaciones del seller con un status dado (active/paused). */
export async function searchMyItemIds(status: 'active' | 'paused'): Promise<string[]> {
  const userId = await getMlUserId()
  const ids: string[] = []
  const limit = 100
  for (let offset = 0; offset < 10_000; offset += limit) {
    const page = await mlFetch<MlItemsSearch>(
      `/users/${userId}/items/search?status=${status}&limit=${limit}&offset=${offset}`
    )
    ids.push(...(page.results ?? []))
    if ((page.results ?? []).length < limit) break
  }
  return ids
}

export interface MlItemLite {
  id: string
  title: string
  status?: string
  sub_status?: string[]
  permalink?: string
  price?: number
  available_quantity?: number
  seller_custom_field?: string | null
  variations?: { id: number; available_quantity?: number; seller_custom_field?: string | null }[]
}

/** Multiget de ítems (de a 20, que es el máximo de ML). */
export async function getItemsLite(ids: string[]): Promise<MlItemLite[]> {
  const out: MlItemLite[] = []
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20)
    const res = await mlFetch<{ code: number; body: MlItemLite }[]>(
      `/items?ids=${chunk.join(',')}&attributes=id,title,status,sub_status,permalink,price,available_quantity,seller_custom_field,variations`
    )
    for (const r of res) if (r.code === 200 && r.body) out.push(r.body)
  }
  return out
}

export function updateItem(itemId: string, body: Record<string, unknown>): Promise<MlItemLite> {
  return mlFetch<MlItemLite>(`/items/${itemId}`, { method: 'PUT', body: JSON.stringify(body) })
}

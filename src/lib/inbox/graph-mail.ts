/**
 * Cliente de Microsoft Graph para ingest de mails entrantes.
 *
 * Reutiliza las credenciales Azure AD que ya están en .env para envío
 * (ver src/lib/email/microsoft-graph.ts) y agrega las operaciones de:
 *  - obtener un access token con Mail.Read
 *  - crear/renovar subscriptions de cambios sobre /messages
 *  - traer un mensaje específico cuando llega una notificación
 *
 * Permisos necesarios en la App Registration de Azure (application perms):
 *   Mail.Read  — para leer mensajes entrantes
 *   Mail.Send  — ya estaba (envío)
 * Admin consent requerido.
 */

import { ConfidentialClientApplication } from '@azure/msal-node'
import { logger } from '@/lib/logger'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

// ─── Token (cacheado en memoria mientras viva el módulo) ────────────────────

let cachedToken: { value: string; expiresAt: number } | null = null

export async function getGraphToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value
  }

  const TENANT_ID = process.env.AZURE_TENANT_ID || ''
  const CLIENT_ID = process.env.AZURE_CLIENT_ID || ''
  const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || ''

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Azure credentials no configuradas')
  }

  const msalClient = new ConfidentialClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      clientSecret: CLIENT_SECRET,
    },
  })

  const result = await msalClient.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  })

  if (!result?.accessToken) throw new Error('No se pudo obtener access token de Graph')

  const expiresAt = result.expiresOn ? result.expiresOn.getTime() : Date.now() + 3500_000
  cachedToken = { value: result.accessToken, expiresAt }
  return result.accessToken
}

// ─── Subscriptions ──────────────────────────────────────────────────────────

export interface GraphSubscriptionResponse {
  id: string
  resource: string
  changeType: string
  clientState?: string
  notificationUrl: string
  expirationDateTime: string
}

/**
 * Microsoft Graph soporta como máximo ~71hs (4230 min) para subscriptions
 * de mensajes. Por seguridad pedimos 3 días - 30min y dejamos que el cron
 * de renovación se encargue.
 */
export function defaultMailSubscriptionExpiration(): Date {
  return new Date(Date.now() + (71 * 60 - 30) * 60_000)
}

export async function createMailSubscription(params: {
  userUpn: string
  notificationUrl: string
  clientState: string
  expirationDateTime?: Date
}): Promise<GraphSubscriptionResponse> {
  const token = await getGraphToken()
  const expiresAt = (params.expirationDateTime ?? defaultMailSubscriptionExpiration()).toISOString()

  const body = {
    changeType: 'created',
    notificationUrl: params.notificationUrl,
    resource: `users/${params.userUpn}/messages`,
    expirationDateTime: expiresAt,
    clientState: params.clientState,
  }

  const res = await fetch(`${GRAPH_BASE}/subscriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Graph subscription create falló: ${res.status} ${text}`)
  }

  return (await res.json()) as GraphSubscriptionResponse
}

export async function renewMailSubscription(
  subscriptionId: string,
  expirationDateTime: Date = defaultMailSubscriptionExpiration()
): Promise<GraphSubscriptionResponse> {
  const token = await getGraphToken()
  const res = await fetch(`${GRAPH_BASE}/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expirationDateTime: expirationDateTime.toISOString() }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Graph subscription renew falló: ${res.status} ${text}`)
  }
  return (await res.json()) as GraphSubscriptionResponse
}

export async function deleteMailSubscription(subscriptionId: string): Promise<void> {
  const token = await getGraphToken()
  const res = await fetch(`${GRAPH_BASE}/subscriptions/${subscriptionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok && res.status !== 404) {
    const text = await res.text()
    logger.warn(`[Graph] Delete subscription respondió ${res.status}: ${text}`)
  }
}

// ─── Lectura de mensajes ────────────────────────────────────────────────────

export interface GraphMessage {
  id: string
  conversationId: string
  internetMessageId?: string
  subject?: string
  bodyPreview?: string
  body?: { contentType: 'html' | 'text'; content: string }
  from?: { emailAddress?: { name?: string; address?: string } }
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>
  receivedDateTime?: string
  sentDateTime?: string
  hasAttachments?: boolean
  isRead?: boolean
}

export async function fetchMessage(userUpn: string, messageId: string): Promise<GraphMessage> {
  const token = await getGraphToken()
  const url = `${GRAPH_BASE}/users/${userUpn}/messages/${encodeURIComponent(messageId)}?$select=id,conversationId,internetMessageId,subject,bodyPreview,body,from,toRecipients,receivedDateTime,sentDateTime,hasAttachments,isRead`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Graph fetch message falló: ${res.status} ${text}`)
  }
  return (await res.json()) as GraphMessage
}

/**
 * Extrae el UPN del path `Users/{guid o upn}/Messages/{id}`.
 * Las notificaciones de Graph mandan el resource con el GUID del usuario,
 * pero también podría ser el UPN si así lo registramos.
 */
export function parseResourceUserKey(resource: string): string | null {
  const m = resource.match(/^Users\/([^/]+)\/Messages\/([^/]+)$/i)
  return m ? m[1] : null
}

export function parseResourceMessageId(resource: string): string | null {
  const m = resource.match(/^Users\/([^/]+)\/Messages\/([^/]+)$/i)
  return m ? decodeURIComponent(m[2]) : null
}

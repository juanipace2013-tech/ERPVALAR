/**
 * Busca en los buzones de la empresa los mails donde puede haber llegado la
 * Orden de Compra de una cotización, para adjuntarla sin descargarla a mano.
 *
 * Se busca (Graph $search) por número de cotización, número de OC si ya está
 * cargado, y dominio del mail del cliente, en ventas@, administración@ y la
 * casilla del vendedor. Solo mails con adjuntos PDF/JPG/PNG no embebidos.
 */
import { getGraphToken, listAttachments } from '@/lib/inbox/graph-mail'
import { logger } from '@/lib/logger'

const G = 'https://graph.microsoft.com/v1.0'
const DOMINIO_PROPIO = 'val-ar.com.ar'
const BUZONES_FIJOS = ['ventas@val-ar.com.ar', 'administracion@val-ar.com.ar']
const DOMINIOS_GENERICOS = /^(gmail|hotmail|outlook|yahoo|live|icloud|msn|fibertel|speedy|arnet)\./i
const EXT_OC = /\.(pdf|jpe?g|png)$/i
const DIAS = 90
const MAX_MAILS = 12

export interface OcMailAdjunto {
  id: string
  name: string
  size: number
}

export interface OcMailMensaje {
  buzon: string
  messageId: string
  asunto: string
  de: string
  fecha: string
  adjuntos: OcMailAdjunto[]
}

export interface OcMailCriterio {
  quoteNumber: string
  purchaseOrderNumber?: string | null
  emailsCliente: Array<string | null | undefined>
  emailVendedor?: string | null
}

interface Msg {
  id: string
  internetMessageId?: string
  subject?: string
  receivedDateTime: string
  hasAttachments?: boolean
  from?: { emailAddress?: { name?: string; address?: string } }
}

/** Buzones propios donde buscar: los fijos + el del vendedor si es de la empresa */
export function buzonesOC(emailVendedor?: string | null): string[] {
  const v = (emailVendedor || '').trim().toLowerCase()
  const out = [...BUZONES_FIJOS]
  if (v.endsWith(`@${DOMINIO_PROPIO}`) && !out.includes(v)) out.push(v)
  return out
}

/** Textos a buscar: cotización, OC y dominios (o mail completo si es genérico) del cliente */
export function terminosOC(c: OcMailCriterio): string[] {
  const out: string[] = [c.quoteNumber]
  const oc = c.purchaseOrderNumber?.trim()
  if (oc && oc.length >= 4) out.push(oc)
  for (const e of c.emailsCliente
    .flatMap((x) => (x ?? '').split(/[;,\s]+/))
    .map((x) => x.trim().toLowerCase())) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) continue
    const dom = e.split('@')[1]
    if (dom === DOMINIO_PROPIO) continue
    out.push(DOMINIOS_GENERICOS.test(dom) ? e : dom)
  }
  return [...new Set(out)]
}

async function buscar(buzon: string, texto: string): Promise<Msg[]> {
  const token = await getGraphToken()
  const q = encodeURIComponent(`"${texto.replace(/"/g, '')}"`)
  const res = await fetch(
    `${G}/users/${buzon}/messages?$search=${q}&$top=25&$select=id,internetMessageId,subject,receivedDateTime,hasAttachments,from`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  return ((await res.json()) as { value?: Msg[] }).value ?? []
}

export async function buscarMailsOC(c: OcMailCriterio, ahora = new Date()): Promise<OcMailMensaje[]> {
  const desde = ahora.getTime() - DIAS * 86400_000
  const terminos = terminosOC(c)
  const candidatos: Array<{ buzon: string; m: Msg }> = []
  let fallas = 0
  let intentos = 0

  await Promise.all(
    buzonesOC(c.emailVendedor).flatMap((buzon) =>
      terminos.map(async (t) => {
        intentos++
        try {
          for (const m of await buscar(buzon, t)) {
            if (!m.hasAttachments || new Date(m.receivedDateTime).getTime() < desde) continue
            // No ofrecer lo que mandamos nosotros (cotizaciones, facturas)
            if ((m.from?.emailAddress?.address || '').toLowerCase().endsWith(`@${DOMINIO_PROPIO}`)) continue
            candidatos.push({ buzon, m })
          }
        } catch (e) {
          fallas++
          logger.warn(`[OC mail] Búsqueda "${t}" en ${buzon} falló: ${(e as Error).message}`)
        }
      })
    )
  )
  if (intentos > 0 && fallas === intentos) throw new Error('No se pudo consultar el correo')

  // Un mismo mail puede estar en varios buzones o salir por varios términos
  const vistos = new Set<string>()
  const unicos = candidatos
    .sort((a, b) => b.m.receivedDateTime.localeCompare(a.m.receivedDateTime))
    .filter(({ m }) => {
      const k = m.internetMessageId || m.id
      if (vistos.has(k)) return false
      vistos.add(k)
      return true
    })
    .slice(0, MAX_MAILS)

  const out = await Promise.all(
    unicos.map(async ({ buzon, m }): Promise<OcMailMensaje | null> => {
      try {
        const adjuntos = (await listAttachments(buzon, m.id))
          .filter((a) => !a.isInline && EXT_OC.test(a.name || ''))
          .map((a) => ({ id: a.id, name: a.name, size: a.size ?? 0 }))
        if (!adjuntos.length) return null
        return {
          buzon,
          messageId: m.id,
          asunto: m.subject || '(sin asunto)',
          de: m.from?.emailAddress?.name || m.from?.emailAddress?.address || '',
          fecha: m.receivedDateTime,
          adjuntos,
        }
      } catch {
        return null
      }
    })
  )
  return out.filter((x): x is OcMailMensaje => x !== null)
}

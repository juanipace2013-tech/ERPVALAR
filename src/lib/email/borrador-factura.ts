/**
 * Al emitir una factura, deja armado en el buzón de administración (Caro) el
 * borrador del mail al cliente, como lo arma ella a mano:
 *
 *   Asunto: "Factura VALAR 00000198 // RE: <asunto del hilo de la OC>"
 *   Para:   administración/facturas del cliente   CC: resto del hilo + ventas@
 *   Texto:  "...les envío la FCA 0007-00000198 que corresponde a la Orden de
 *            Compra N° X y Cotización VAL-...". + firma
 *   Adjuntos: PDF de la factura + constancia de CBU, datos bancarios y legajo
 *            impositivo (copiados del último "Factura VALAR" que mandó ella,
 *            así cuando actualiza la constancia del mes se toma la nueva).
 *
 * El hilo se busca en el buzón: primero por número de cotización y de OC; si
 * no aparece, el último mail de ventas@ reenviado a administración donde
 * participa el dominio del cliente. Sin hilo → mail nuevo al email del cliente.
 *
 * Requiere el permiso Graph de aplicación Mail.ReadWrite (crear borradores).
 * Variables de entorno:
 *   BORRADOR_FACTURA_MAIL=1        activa el armado automático al emitir
 *   BORRADOR_FACTURA_BUZON         buzón (default administracion@val-ar.com.ar)
 *
 * Nunca lanza: es best-effort y no puede romper la facturación.
 */
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { getGraphToken } from '@/lib/inbox/graph-mail'
import { buildFacturaPdfData } from '@/lib/facturacion/factura-pdf-data'
import { generateFacturaPDF, facturaPdfFilename, type FacturaPDFData } from '@/lib/pdf/factura-generator'

const G = 'https://graph.microsoft.com/v1.0'
const DOMINIO_PROPIO = 'val-ar.com.ar'
const VENTAS = 'ventas@val-ar.com.ar'
const DOMINIOS_GENERICOS = /^(gmail|hotmail|outlook|yahoo|live|icloud|msn|fibertel|speedy|arnet)\./i
/** Hilos que no son el de la OC aunque mencionen el número */
const ASUNTO_DESCARTADO = /factura valar|recibo valar|retenciones|certificado de calidad|nota de cr[eé]dito/i
/** Local-part de las casillas que reciben facturas: van en Para */
const CASILLA_ADMIN = /admin|factur|proveedor|cuentas|pagar|pagos|finanz|tesorer|contab/i
/** Adjuntos fijos que manda Caro con cada factura */
const ADJUNTO_FIJO = /cbu|datos bancarios|legajo/i

export function buzonBorradores(): string {
  return process.env.BORRADOR_FACTURA_BUZON || 'administracion@val-ar.com.ar'
}

export function borradorFacturaActivo(): boolean {
  return process.env.BORRADOR_FACTURA_MAIL === '1'
}

// ─── Datos de la factura ─────────────────────────────────────────────────────

export interface DatosBorrador {
  pdf: FacturaPDFData
  quoteNumber: string | null
  ordenCompra: string | null
  emailsCliente: string[]
}

async function cargarDatos(invoiceId: string): Promise<DatosBorrador | null> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      quote: { select: { quoteNumber: true, purchaseOrderNumber: true } },
      customer: { select: { email: true, contacts: { select: { email: true } } } },
    },
  })
  if (!inv) return null
  const pdf = await buildFacturaPdfData(invoiceId)
  if (!pdf) return null
  const emails = [inv.customer.email, ...inv.customer.contacts.map((c) => c.email)]
    .flatMap((e) => (e ?? '').split(/[;,\s]+/))
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
  return {
    pdf,
    quoteNumber: inv.quote?.quoteNumber ?? null,
    ordenCompra: inv.quote?.purchaseOrderNumber?.trim() || null,
    emailsCliente: [...new Set(emails)],
  }
}

// ─── Texto ───────────────────────────────────────────────────────────────────

const nro8 = (n: number) => String(n).padStart(8, '0')
const nroCompleto = (pv: number, n: number) => `${String(pv).padStart(4, '0')}-${nro8(n)}`

/** "FCA 0007-00000198" como lo escribe Caro */
export function nombreComprobante(d: Pick<FacturaPDFData, 'letra' | 'cbteTipo' | 'puntoVenta' | 'numero'>): string {
  const nro = nroCompleto(d.puntoVenta, d.numero)
  if (d.cbteTipo >= 201) return `Factura de Crédito Electrónica MiPyME ${d.letra} ${nro}`
  if (d.letra === 'E') return `Factura E ${nro}`
  return `FC${d.letra} ${nro}`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function saludo(ahora: Date): string {
  const hora = Number(
    new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hour12: false }).format(ahora)
  )
  return hora < 13 ? 'Muy buenos días' : 'Muy buenas tardes'
}

const FIRMA = `
<p style="margin:0;color:#1F4E79"><b>Carolina Rutolo</b><br><b>VALAR</b><br>
14 de Julio 175.<br>Paternal | Capital Federal<br>
<b>Office:</b> + 54 (11) 4551-3343 | 4552-2874 | <b>WhatsApp:</b> (11) 6055 1683<br>
Atención Comercial: Lunes a Viernes de 09 a 16:30 hs.<br>
CUIT: 30-71537357-9<br>
<a href="https://www.val-ar.com.ar">www.val-ar.com.ar</a><br>
<a href="mailto:administracion@val-ar.com.ar">administracion@val-ar.com.ar</a> | <a href="mailto:ventas@val-ar.com.ar">ventas@val-ar.com.ar</a><br>
<span style="color:#2E7D32">El cuidado del Medio Ambiente es una tarea de todos, <b>sólo imprima si es necesario</b>.</span></p>`

export function cuerpoHtml(d: DatosBorrador, ahora = new Date()): string {
  const refs: string[] = []
  if (d.ordenCompra) refs.push(`la <b>Orden de Compra N° ${esc(d.ordenCompra)}</b>`)
  if (d.quoteNumber) refs.push(`${refs.length ? '' : 'la '}<b>Cotización ${esc(d.quoteNumber)}</b>`)
  const corresponde = refs.length ? ` que corresponde a ${refs.join(' y ')}` : ''
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">
<p>${saludo(ahora)}. Un gusto saludarlos/as.</p>
<p>A través de este correo les envío la <b>${esc(nombreComprobante(d.pdf))}</b>${corresponde}.</p>
<p>Del mismo modo, se adjuntan nuestros datos bancarios y el legajo impositivo actualizado, para su consideración.</p>
<p><br></p>
<p>Muchas gracias,<br>Saludos,</p>
<p><br></p>
${FIRMA}
</div>`
}

export function asuntoFactura(d: Pick<FacturaPDFData, 'numero'>, asuntoHilo?: string | null): string {
  const base = `Factura VALAR ${nro8(d.numero)}`
  if (!asuntoHilo?.trim()) return base
  // "RV: X" / "FW: X" (reenvío interno de ventas@) → "RE: X", como lo escribe Caro
  const hilo = asuntoHilo.trim().replace(/^((re|rv|fw|fwd)\s*:\s*)+/i, '')
  return `${base} // RE: ${hilo}`
}

// ─── Graph helpers ───────────────────────────────────────────────────────────

type Addr = { emailAddress: { address: string; name?: string } }
interface MsgHilo {
  id: string
  subject: string
  receivedDateTime: string
  from?: Addr
  toRecipients: Addr[]
  ccRecipients: Addr[]
}

async function graph<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getGraphToken()
  const res = await fetch(`${G}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if (!res.ok) {
    const det = (await res.text().catch(() => '')).slice(0, 400)
    throw new Error(`Graph ${init.method || 'GET'} ${path.split('?')[0]} ${res.status}: ${det}`)
  }
  return (res.status === 204 ? null : await res.json()) as T
}

const SELECT_HILO = 'id,subject,receivedDateTime,from,toRecipients,ccRecipients'
const dir = (a?: Addr) => (a?.emailAddress?.address || '').toLowerCase()
const participantes = (m: MsgHilo) => [m.from, ...m.toRecipients, ...m.ccRecipients].map(dir).filter(Boolean)

async function buscar(buzon: string, texto: string): Promise<MsgHilo[]> {
  const q = encodeURIComponent(`"${texto.replace(/"/g, '')}"`)
  const r = await graph<{ value: MsgHilo[] }>(`/users/${buzon}/messages?$search=${q}&$top=25&$select=${SELECT_HILO}`)
  return r.value ?? []
}

/** El mail más reciente del hilo de la OC/cotización, o null */
export async function buscarHilo(
  buzon: string,
  d: Pick<DatosBorrador, 'quoteNumber' | 'ordenCompra' | 'emailsCliente'>,
  antesDe: Date = new Date()
): Promise<MsgHilo | null> {
  const valido = (m: MsgHilo) =>
    !ASUNTO_DESCARTADO.test(m.subject || '') && new Date(m.receivedDateTime) <= antesDe
  const masReciente = (ms: MsgHilo[]) =>
    ms.sort((a, b) => b.receivedDateTime.localeCompare(a.receivedDateTime))[0] ?? null

  // 1) Por número de cotización / OC
  for (const t of [d.quoteNumber, d.ordenCompra]) {
    if (!t || t.length < 4) continue
    const m = masReciente((await buscar(buzon, t)).filter(valido))
    if (m) return m
  }
  // 2) Último mail de los últimos 60 días donde participa el dominio del cliente
  const dominios = [...new Set(d.emailsCliente.map((e) => e.split('@')[1]))].filter(
    (dom) => dom && dom !== DOMINIO_PROPIO && !DOMINIOS_GENERICOS.test(dom)
  )
  const desde = antesDe.getTime() - 60 * 86400_000
  for (const dom of dominios) {
    const ms = (await buscar(buzon, dom)).filter(
      (m) => valido(m) && new Date(m.receivedDateTime).getTime() >= desde && participantes(m).some((p) => p.endsWith(`@${dom}`))
    )
    const m = masReciente(ms)
    if (m) return m
  }
  return null
}

/** Para: casillas de administración del cliente (o quien escribió); CC: resto + ventas@ */
export function destinatarios(hilo: MsgHilo | null, emailsCliente: string[], buzon: string) {
  const nombres = new Map<string, string | undefined>()
  const externos: string[] = []
  const add = (a?: Addr) => {
    const e = dir(a)
    if (!e || e.endsWith(`@${DOMINIO_PROPIO}`) || externos.includes(e)) return
    externos.push(e)
    nombres.set(e, a?.emailAddress?.name)
  }
  if (hilo) {
    add(hilo.from)
    hilo.toRecipients.forEach(add)
    hilo.ccRecipients.forEach(add)
  }
  // Casillas de administración cargadas en el ERP (p. ej. cuentasporpagar@): siempre.
  // Si el hilo no trajo a nadie del cliente (reenvío interno), todos los emails del ERP.
  const sinExternos = externos.length === 0
  emailsCliente
    .filter((e) => sinExternos || CASILLA_ADMIN.test(e.split('@')[0]))
    .forEach((e) => add({ emailAddress: { address: e } }))
  let para = externos.filter((e) => CASILLA_ADMIN.test(e.split('@')[0]))
  if (!para.length) para = externos.slice(0, 1)
  const cc = externos.filter((e) => !para.includes(e))
  if (buzon.toLowerCase() !== VENTAS) cc.push(VENTAS)
  const fmt = (e: string): Addr => ({ emailAddress: { address: e, ...(nombres.get(e) ? { name: nombres.get(e) } : {}) } })
  return { para: para.map(fmt), cc: cc.map(fmt) }
}

interface AdjuntoFijo {
  name: string
  contentType: string
  contentBytes: string
}

/** Constancia de CBU, datos bancarios y legajo del último "Factura VALAR" enviado */
export async function adjuntosFijos(buzon: string): Promise<AdjuntoFijo[]> {
  const enviados = await graph<{ value: Array<{ id: string; subject: string; hasAttachments: boolean }> }>(
    `/users/${buzon}/mailFolders/sentitems/messages?$top=50&$orderby=sentDateTime desc&$select=id,subject,hasAttachments`
  )
  for (const m of enviados.value) {
    if (!m.hasAttachments || !/^factura valar/i.test(m.subject || '')) continue
    const lista = await graph<{ value: Array<{ id: string; name: string; isInline: boolean }> }>(
      `/users/${buzon}/messages/${m.id}/attachments?$select=id,name,isInline`
    )
    const fijos = lista.value.filter((a) => !a.isInline && ADJUNTO_FIJO.test(a.name))
    if (!fijos.length) continue
    const out: AdjuntoFijo[] = []
    for (const a of fijos) {
      const full = await graph<AdjuntoFijo>(`/users/${buzon}/messages/${m.id}/attachments/${a.id}`)
      out.push({ name: full.name, contentType: full.contentType, contentBytes: full.contentBytes })
    }
    return out
  }
  return []
}

// ─── Armado ──────────────────────────────────────────────────────────────────

export type ResultadoBorrador =
  | {
      ok: true
      dryRun?: boolean
      draftId?: string
      webLink?: string
      asunto: string
      para: string[]
      cc: string[]
      hilo: string | null
      adjuntos: string[]
      yaExistia?: boolean
    }
  | { ok: false; error: string; omitido?: boolean }

export async function armarBorradorFactura(
  invoiceId: string,
  opts: { dryRun?: boolean; antesDe?: Date } = {}
): Promise<ResultadoBorrador> {
  const buzon = buzonBorradores()
  try {
    const d = await cargarDatos(invoiceId)
    if (!d) return { ok: false, omitido: true, error: 'La factura no fue emitida por el ERP' }
    if (d.pdf.clase !== 'FACTURA') return { ok: false, omitido: true, error: 'Solo facturas (no NC/ND)' }

    const asuntoBase = asuntoFactura(d.pdf)
    // No duplicar si ya hay un borrador de esta factura
    const previos = await graph<{ value: Array<{ id: string; subject: string; webLink: string }> }>(
      `/users/${buzon}/mailFolders/drafts/messages?$top=50&$select=id,subject,webLink&$filter=${encodeURIComponent(
        `startswith(subject,'${asuntoBase}')`
      )}`
    )
    if (previos.value.length && !opts.dryRun) {
      const p = previos.value[0]
      return { ok: true, yaExistia: true, draftId: p.id, webLink: p.webLink, asunto: p.subject, para: [], cc: [], hilo: null, adjuntos: [] }
    }

    const hilo = await buscarHilo(buzon, d, opts.antesDe)
    const { para, cc } = destinatarios(hilo, d.emailsCliente, buzon)
    const asunto = asuntoFactura(d.pdf, hilo?.subject)
    const html = cuerpoHtml(d)
    const fijos = await adjuntosFijos(buzon)
    const pdfNombre = facturaPdfFilename(d.pdf)
    const resumen = {
      asunto,
      para: para.map(dir),
      cc: cc.map(dir),
      hilo: hilo ? `${hilo.receivedDateTime} ${hilo.subject}` : null,
      adjuntos: [pdfNombre, ...fijos.map((f) => f.name)],
    }
    if (opts.dryRun) return { ok: true, dryRun: true, ...resumen }
    if (!para.length) return { ok: false, error: 'No hay hilo ni email del cliente para armar el borrador' }

    const message = { subject: asunto, toRecipients: para, ccRecipients: cc }
    const draft = hilo
      ? await graph<{ id: string; webLink: string }>(`/users/${buzon}/messages/${hilo.id}/createReplyAll`, {
          method: 'POST',
          body: JSON.stringify({ message, comment: html }),
        })
      : await graph<{ id: string; webLink: string }>(`/users/${buzon}/messages`, {
          method: 'POST',
          body: JSON.stringify({ ...message, body: { contentType: 'HTML', content: html } }),
        })

    const pdf = await generateFacturaPDF(d.pdf)
    const adjuntos = [
      { name: pdfNombre, contentType: 'application/pdf', contentBytes: Buffer.from(pdf).toString('base64') },
      ...fijos,
    ]
    for (const a of adjuntos) {
      await graph(`/users/${buzon}/messages/${draft.id}/attachments`, {
        method: 'POST',
        body: JSON.stringify({ '@odata.type': '#microsoft.graph.fileAttachment', ...a }),
      })
    }
    logger.info(`[BorradorFactura] ${asunto} → ${resumen.para.join(', ')}`)
    return { ok: true, draftId: draft.id, webLink: draft.webLink, ...resumen }
  } catch (e) {
    const msg = (e as Error).message
    logger.error(`[BorradorFactura] No se pudo armar el borrador de ${invoiceId}: ${msg}`)
    return { ok: false, error: msg }
  }
}

/** Fire-and-forget para llamar después de emitir */
export function armarBorradorFacturaBg(invoiceId: string | null | undefined): void {
  if (!invoiceId || !borradorFacturaActivo()) return
  void armarBorradorFactura(invoiceId)
}

/**
 * Archiva en SharePoint el PDF de cada comprobante emitido por el ERP (ARCA):
 *   SP - VALARG / Documentos / Facturas Emitidas / VAL ARG S.R.L / "10 2026" /
 *     "Factura A 0007-00000006 CLORO MENDOZA SOCIEDAD ANONIMA.pdf"
 * (misma carpeta y mismo nombre que se usaban al descargar a mano). La Factura
 * E de exportación va en la misma carpeta del mes, con su letra y su PV:
 *     "Factura E 0010-00000001 <CLIENTE>.pdf"
 *
 * Usa la app de Azure del ERP (getGraphToken, client credentials) con el
 * permiso Graph "Sites.Selected" + permiso write otorgado SOLO sobre el sitio.
 *
 * Variables de entorno:
 *   SHAREPOINT_FACTURAS_SITE_ID  — id del sitio (host,siteCollectionId,webId). Sin él no hace nada.
 *   SHAREPOINT_FACTURAS_FOLDER   — carpeta base dentro de la biblioteca por defecto
 *                                  (default "Facturas Emitidas/VAL ARG S.R.L").
 *
 * Nunca lanza: el archivado es best-effort y no puede romper la facturación.
 */
import { logger } from '@/lib/logger'
import { getGraphToken } from '@/lib/inbox/graph-mail'
import { buildFacturaPdfData } from '@/lib/facturacion/factura-pdf-data'
import { generateFacturaPDF, facturaPdfFilename } from '@/lib/pdf/factura-generator'

const GRAPH = 'https://graph.microsoft.com/v1.0'

export function sharepointFacturasConfigurado(): boolean {
  return !!process.env.SHAREPOINT_FACTURAS_SITE_ID
}

/** "10 2026": mes y año de emisión en hora argentina. */
export function carpetaMes(fecha: Date): string {
  const partes = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(fecha)
  const mes = (partes.find((p) => p.type === 'month')?.value ?? '1').padStart(2, '0')
  const anio = partes.find((p) => p.type === 'year')?.value ?? String(fecha.getFullYear())
  return `${mes} ${anio}`
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

export type ResultadoArchivo =
  | { ok: true; path: string; yaExistia: boolean }
  | { ok: false; error: string; omitido?: boolean }

/**
 * Sube el PDF de la factura a SharePoint. Si el archivo ya existe (p. ej.
 * descargado y guardado a mano) no lo pisa.
 */
export async function archivarFacturaEnSharePoint(invoiceId: string): Promise<ResultadoArchivo> {
  const siteId = process.env.SHAREPOINT_FACTURAS_SITE_ID
  if (!siteId) return { ok: false, omitido: true, error: 'SHAREPOINT_FACTURAS_SITE_ID no configurado' }
  const base = (process.env.SHAREPOINT_FACTURAS_FOLDER || 'Facturas Emitidas/VAL ARG S.R.L').replace(/^\/+|\/+$/g, '')

  try {
    const data = await buildFacturaPdfData(invoiceId)
    if (!data) return { ok: false, omitido: true, error: 'La factura no fue emitida por el ERP' }
    const pdf = await generateFacturaPDF(data)
    const path = `${base}/${carpetaMes(data.fecha)}/${facturaPdfFilename(data)}`

    const token = await getGraphToken()
    // PUT por ruta: crea las carpetas que falten. conflictBehavior=fail → no pisa.
    const res = await fetch(
      `${GRAPH}/sites/${siteId}/drive/root:/${encodePath(path)}:/content?@microsoft.graph.conflictBehavior=fail`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf' },
        body: new Uint8Array(pdf),
      }
    )
    if (res.status === 409) return { ok: true, path, yaExistia: true }
    if (!res.ok) {
      const detalle = (await res.text().catch(() => '')).slice(0, 500)
      throw new Error(`Graph PUT ${res.status}: ${detalle}`)
    }
    logger.info(`[SharePoint] Factura archivada: ${path}`)
    return { ok: true, path, yaExistia: false }
  } catch (e) {
    const msg = (e as Error).message
    logger.error(`[SharePoint] No se pudo archivar la factura ${invoiceId}: ${msg}`)
    return { ok: false, error: msg }
  }
}

/** Fire-and-forget para llamar después de emitir (no demora la respuesta). */
export function archivarFacturaEnSharePointBg(invoiceId: string | null | undefined): void {
  if (!invoiceId || !sharepointFacturasConfigurado()) return
  void archivarFacturaEnSharePoint(invoiceId)
}

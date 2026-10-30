/**
 * Reglas puras para cruzar NC hechas directo en Colppy contra facturas de
 * comisiones (sin base de datos, para poder testearlas).
 */

/** Prefijo en errorMessage de la factura anulada por una NC del mismo mes: "ANULADA_POR_NC:<ncId>: ...". */
export const MARCA_ANULADA_POR_NC = 'ANULADA_POR_NC:'

/**
 * Marca en errorMessage de la fila NOTA_CREDITO creada por una NC de Colppy
 * de un mes posterior a la factura: "NC_COLPPY:<ncId>:<facturaOriginalId>: ...".
 */
export const MARCA_NC_COLPPY = 'NC_COLPPY:'

const RE_NC_COLPPY = /NC_COLPPY:([^:\s]+):([^:\s]+):/

export type MarcaNC = { ncId: string; facturaId: string | null }

/** Lee el marcador de NC de Colppy de un errorMessage (cualquiera de los dos). */
export function leerMarcaNC(errorMessage: string | null | undefined): MarcaNC | null {
  if (!errorMessage) return null
  if (errorMessage.startsWith(MARCA_ANULADA_POR_NC)) {
    const ncId = errorMessage.split(':')[1]
    return ncId ? { ncId, facturaId: null } : null
  }
  const m = RE_NC_COLPPY.exec(errorMessage)
  return m ? { ncId: m[1], facturaId: m[2] } : null
}

/** Neto de una NC/FAV (sin IVA); si el sync no trajo subtotal, cae al total. */
export function netoComprobante(c: { subtotal: unknown; total: unknown }): number {
  return Number(c.subtotal) > 0 ? Number(c.subtotal) : Number(c.total)
}

/** Mismo importe con tolerancia 0,5% (mín USD 1) por redondeos de TC. */
export function mismoImporte(a: number, b: number): boolean {
  return Math.abs(Math.abs(a) - Math.abs(b)) <= Math.max(1, Math.abs(b) * 0.005)
}

/**
 * ¿El número cargado a mano corresponde al comprobante? Compara solo dígitos
 * sin ceros a la izquierda y acepta que se haya cargado solo el final
 * ("1301" ≈ "0003-00001301").
 */
export function mismoNumeroComprobante(cargado: string | null | undefined, real: string): boolean {
  const norm = (s: string) => s.replace(/\D/g, '').replace(/^0+/, '')
  const a = norm(cargado ?? '')
  const b = norm(real)
  if (!a || !b) return false
  return a === b || b.endsWith(a)
}

type ComprobanteFecha = { id: string; customerId: string | null; subtotal: unknown; total: unknown; issueDate: Date }

/**
 * Refacturación: patrón "factura → NC → factura nueva por el mismo neto"
 * (pedido burocrático del cliente). Devuelve la FAV nueva (mismo cliente, mismo
 * neto que la NC, emitida el día de la NC o después, distinta de la original).
 */
export function buscarRefactura<T extends ComprobanteFecha>(
  nc: ComprobanteFecha,
  favs: T[],
  facturaOriginalInvoiceId: string | null
): T | undefined {
  const netoNC = netoComprobante(nc)
  return favs.find(
    (f) =>
      f.id !== facturaOriginalInvoiceId &&
      f.customerId === nc.customerId &&
      f.issueDate.getTime() >= nc.issueDate.getTime() &&
      mismoImporte(netoComprobante(f), netoNC)
  )
}

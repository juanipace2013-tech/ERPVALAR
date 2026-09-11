/**
 * Remitentes desde los que el cron ingest-facturas-mail carga facturas de
 * compra sin intervención. Todo lo que llegue a la casilla de facturación
 * desde otra dirección se ignora (sigue el circuito manual de siempre).
 *
 * Para sumar un proveedor: agregar una fila. `supplierNamePattern` se usa
 * para verificar que el CUIT que leyó el OCR cayó en el proveedor esperado
 * (y como fallback si el CUIT no matchea ningún proveedor del ERP).
 */

export interface TrustedInvoiceSender {
  /** Dirección en minúsculas. */
  address: string
  label: string
  supplierNamePattern: RegExp
  /**
   * Product.brand de los artículos de este proveedor. Cuando el código de la
   * factura no coincide exacto con un SKU, se compara sin espacios ni guiones
   * pero solo dentro de esta marca (entre marcas hay colisiones, ej. "3342 07"
   * y "334207").
   */
  brand?: string
}

export const TRUSTED_INVOICE_SENDERS: TrustedInvoiceSender[] = [
  {
    address: 'facturaelectronica@genebre.com.ar',
    label: 'GENEBRE',
    supplierNamePattern: /genebre/i,
    brand: 'GENEBRE',
  },
]

export function findTrustedSender(address: string | undefined | null): TrustedInvoiceSender | null {
  const needle = (address || '').trim().toLowerCase()
  if (!needle) return null
  return TRUSTED_INVOICE_SENDERS.find((s) => s.address === needle) ?? null
}

/**
 * Número de comprobante a partir del nombre del PDF, cuando el proveedor lo
 * codifica ahí (GENEBRE: "FACA0003100304907.pdf" = FAC A 00031 00304907).
 * Permite descartar duplicados antes de gastar una llamada de OCR.
 */
export function invoiceNumberFromFilename(fileName: string): string | null {
  const m = fileName.match(/^(?:FAC|FC|NCR|NC|NDE|ND)?([ABC])(\d{5})(\d{8})/i)
  if (!m) return null
  return `${m[1].toUpperCase()}${m[2]}-${m[3]}`
}

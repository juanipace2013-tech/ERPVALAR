/**
 * Cantidad facturada NETA de un ítem de cotización: las líneas de facturas
 * vigentes suman y las de notas de crédito (devoluciones por unidades) restan.
 * Antes de las NC por unidades todo se sumaba, y una unidad devuelta seguía
 * contando como facturada mientras la factura original estuviera vigente.
 */
export function signoCantidad(invoice: { transactionType?: string | null } | null | undefined): number {
  return invoice?.transactionType === 'CREDIT_NOTE' ? -1 : 1
}

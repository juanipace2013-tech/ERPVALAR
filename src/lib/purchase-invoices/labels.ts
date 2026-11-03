/** "NC" → "Nota de Crédito"; facturas y tipos desconocidos → "Factura". */
export function comprobanteLabel(invoiceType: string | null | undefined): string {
  if (invoiceType === 'NC') return 'Nota de Crédito'
  if (invoiceType === 'ND') return 'Nota de Débito'
  return 'Factura'
}

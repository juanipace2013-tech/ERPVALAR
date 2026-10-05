/**
 * Letra de la factura de venta según la condición IVA del cliente (emisor RI).
 * Misma regla que ARCA (receptorDesdeCondicion en src/lib/arca/emitir.ts):
 * RI y Monotributo → A (RG 5003/2021, condición 6), el resto → B. Antes el
 * Monotributo iba como B a Colppy mientras ARCA emitía una A con ese número.
 *
 * Módulo puro, sin imports: lo usan el servidor (sendQuoteToColppy, rutas de
 * facturación) y los diálogos 'use client' (SendToColppyDialog), para que la
 * letra que se muestra sea la misma que se emite. Una sola regla.
 */
export function letraFacturaColppy(taxCondition: string | null | undefined): 'A' | 'B' {
  return taxCondition === 'RESPONSABLE_INSCRIPTO' || taxCondition === 'MONOTRIBUTO' ? 'A' : 'B'
}

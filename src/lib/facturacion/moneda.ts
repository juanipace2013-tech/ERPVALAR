/**
 * Facturar en pesos una cotización en USD (excepción para clientes que no
 * aceptan facturas en dólares). Los precios se convierten con el TC elegido en
 * el diálogo; la factura sale en ARS (ARCA, Colppy, PDF). Las comisiones NO
 * cambian: CotizacionFactura.montoUSD se sigue calculando en dólares.
 */
export type MonedaFactura = 'USD' | 'ARS'

const r2 = (n: number) => Math.round(n * 100) / 100

/** true si la cotización es en USD y se pidió facturar en pesos. */
export function facturaEnPesos(quoteCurrency: string, monedaFactura?: string | null): boolean {
  return quoteCurrency === 'USD' && monedaFactura === 'ARS'
}

/**
 * Convierte a pesos los precios de las líneas que van a sendQuoteToColppy
 * (principal y adicionales por separado, redondeados a 2 decimales cada uno,
 * como los arma buildSplitItem).
 */
export function itemsEnPesos<T extends { unitPrice: number; additionals?: Array<{ unitPrice: number }> }>(
  items: T[],
  tc: number
): T[] {
  return items.map((it) => ({
    ...it,
    unitPrice: r2(Number(it.unitPrice) * tc),
    ...(it.additionals ? { additionals: it.additionals.map((a) => ({ ...a, unitPrice: r2(Number(a.unitPrice) * tc) })) } : {}),
  }))
}

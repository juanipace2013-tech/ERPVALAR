/**
 * Imputación de una nota de crédito a su factura en Colppy, igual que el botón
 * "Emitir NC" de la pantalla de la factura: el alta de la NC
 * (alta_facturaventa) lleva `ItemsCobro` con la factura a la que se aplica.
 * Formato tomado del front de Colppy (grilla "Facturas impagas" de la NC,
 * AR_NCNoAplicadas.php): importes en PESOS (moneda "P") aunque la factura sea
 * en dólares; saldoAnterior = saldo de la factura, estePago = lo que aplica la
 * NC, Saldo = lo que le queda. Función pura (testeable).
 */

const r2 = (n: number) => Math.round(n * 100) / 100

export interface ItemCobroColppy {
  idFactura: string
  nroFactura: string
  tipoComprobante: string
  fechaPago: string
  RG: null
  moneda: 'P'
  totalFactura: number
  pagado: number
  saldoAnterior: number
  estePago: number
  Saldo: number
  pagar: true
}

/**
 * @param info infofactura de leer_facturaventa de la factura (totalFactura en
 *   su moneda, rate, currencyIso, saldoaaplicar en pesos, fechaPago dd-mm-aaaa)
 * @param montoNcArs total de la NC en pesos (en USD: total × tipo de cambio)
 * @returns null si no corresponde imputar (factura ya saldada, no es FAV, datos raros)
 */
export function armarImputacionNc(info: Record<string, unknown>, montoNcArs: number): ItemCobroColppy | null {
  // Solo facturas de venta (idTipoComprobante 4 = FAV, también las FCE)
  if (String(info.idTipoComprobante ?? '') !== '4') return null
  const idFactura = String(info.idFactura ?? '')
  const nroFactura = String(info.nroFactura ?? '')
  const fechaPago = String(info.fechaPago ?? '')
  if (!idFactura || !/^\d{4,5}-\d{8}$/.test(nroFactura) || !/^\d{2}-\d{2}-\d{4}$/.test(fechaPago)) return null
  const saldo = r2(Number(info.saldoaaplicar))
  if (!Number.isFinite(saldo) || saldo <= 0.01) return null
  if (!Number.isFinite(montoNcArs) || montoNcArs <= 0) return null
  const esUsd = String(info.currencyIso ?? '').toUpperCase() === 'USD'
  const rate = Number(info.rate)
  if (esUsd && !(rate > 0)) return null
  const totalArs = r2(esUsd ? Number(info.totalFactura) * rate : Number(info.totalFactura))
  if (!(totalArs > 0)) return null
  // Si la factura ya tiene cobros, la NC aplica hasta su saldo; el resto queda a favor del cliente
  const estePago = r2(Math.min(montoNcArs, saldo))
  return {
    idFactura,
    nroFactura,
    tipoComprobante: 'FAV',
    fechaPago,
    RG: null,
    moneda: 'P',
    totalFactura: totalArs,
    pagado: r2(Math.max(0, totalArs - saldo)),
    saldoAnterior: saldo,
    estePago,
    Saldo: r2(saldo - estePago),
    pagar: true,
  }
}

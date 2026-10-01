/**
 * Imputación de una nota de crédito a su factura en Colppy, igual que el botón
 * "Emitir NC" de la pantalla de la factura: el alta de la NC
 * (alta_facturaventa) lleva `ItemsCobro` con la factura a la que se aplica.
 * Formato tomado del front de Colppy (colppyall-min.js: botón "Emitir NC" y
 * grilla "Facturas impagas" de la NC, AR_NCNoAplicadas.php).
 *
 * Unidades (verificado con NC reales en USD hechas con "Emitir NC": SIDERCA
 * 0003-00001291 USD 316,32 → 477.168,72 aplicados = 316,32 × 1.508,5):
 * - estePago va en la MONEDA DE LA NC; Colppy lo pasa a pesos con el tipo de
 *   cambio de la NC.
 * - totalFactura / saldoAnterior de la factura van en pesos (como la grilla).
 * Función pura (testeable).
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

export interface ImputacionNc {
  item: ItemCobroColppy
  /** Saldo en pesos que tiene que quedarle a la factura en Colppy después de la NC */
  saldoEsperadoArs: number
}

/**
 * @param info infofactura de leer_facturaventa de la factura (totalFactura en
 *   su moneda, rate, currencyIso, saldoaaplicar en pesos, fechaPago dd-mm-aaaa)
 * @param nc total de la NC en su moneda y el tipo de cambio con que se registra en Colppy
 * @returns null si no corresponde imputar (factura ya saldada, no es FAV, datos raros)
 */
export function armarImputacionNc(
  info: Record<string, unknown>,
  nc: { total: number; moneda: 'USD' | 'ARS'; tipoCambio: number }
): ImputacionNc | null {
  // Solo facturas de venta (idTipoComprobante 4 = FAV, también las FCE)
  if (String(info.idTipoComprobante ?? '') !== '4') return null
  const idFactura = String(info.idFactura ?? '')
  const nroFactura = String(info.nroFactura ?? '')
  const fechaPago = String(info.fechaPago ?? '')
  if (!idFactura || !/^\d{4,5}-\d{8}$/.test(nroFactura) || !/^\d{2}-\d{2}-\d{4}$/.test(fechaPago)) return null
  const saldoArs = r2(Number(info.saldoaaplicar))
  if (!Number.isFinite(saldoArs) || saldoArs <= 0.01) return null
  if (!Number.isFinite(nc.total) || nc.total <= 0) return null
  const tcNc = nc.moneda === 'USD' ? nc.tipoCambio : 1
  if (!(tcNc > 0)) return null
  const facturaUsd = String(info.currencyIso ?? '').toUpperCase() === 'USD'
  const rateFactura = Number(info.rate)
  if (facturaUsd && !(rateFactura > 0)) return null
  const totalFacturaArs = r2(facturaUsd ? Number(info.totalFactura) * rateFactura : Number(info.totalFactura))
  if (!(totalFacturaArs > 0)) return null
  // Lo que aplica la NC, en su moneda: hasta el saldo de la factura (si ya
  // tiene cobros, el resto de la NC queda a favor del cliente)
  const estePago = r2(Math.min(nc.total, saldoArs / tcNc))
  const aplicadoArs = r2(estePago * tcNc)
  const saldoEsperadoArs = r2(Math.max(0, saldoArs - aplicadoArs))
  return {
    item: {
      idFactura,
      nroFactura,
      tipoComprobante: 'FAV',
      fechaPago,
      RG: null,
      moneda: 'P',
      totalFactura: totalFacturaArs,
      pagado: r2(Math.max(0, totalFacturaArs - saldoArs)),
      saldoAnterior: saldoArs,
      estePago,
      Saldo: saldoEsperadoArs,
      pagar: true,
    },
    saldoEsperadoArs,
  }
}

/**
 * Retención de Ganancias RG 830, régimen 78 (enajenación de bienes muebles),
 * calculada igual que la pantalla de pagos de Colppy (AP_calcularRetencion.php).
 *
 * Verificado al centavo contra Colppy (5/11/2026):
 * - OP 0001-00005506 BMS: 3 facturas, base 4.632.256,44 → retención 88.165,13.
 * - OP 0001-00005301 y 0001-00005372 GENEBRE (sep-2026): 68 + 43 facturas con
 *   percepciones; base 176.876.183,58 y acumulada 232.985.048,67 → 3.533.043,67
 *   y 1.122.177,30.
 *
 * Regla:
 * - neto de cada factura pagada = estePago × (netoGravado + netoNoGravado) / totalFactura
 *   (sin IVA ni percepciones, proporcional si el pago es parcial).
 * - base acumulada del mes = base acumulada del último pago del mes al proveedor
 *   (Colppy la guarda en `baseCalculo1`) + neto de este pago.
 * - retención = (base acumulada − mínimo no sujeto) × alícuota − lo ya retenido en el mes.
 * Función pura (testeable).
 */

export const REGIMEN_78 = {
  codigo: '78',
  /** Mínimo no sujeto a retención mensual (RG 830, vigente 2026) */
  minimoNoSujeto: 224000,
  /** Alícuota para inscriptos */
  alicuota: 0.02,
} as const

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export interface NetoFactura {
  /** Lo que se le paga a la factura en esta OP (pesos) */
  estePago: number
  totalFactura: number
  netoGravado: number
  netoNoGravado: number
}

/** Pago anterior del mismo mes al mismo proveedor, como lo devuelve leer_pago */
export interface PagoPrevioMes {
  idPago: string
  nroPago: string
  fecha: string
  idRetGanancias1: string
  baseCalculo1: number
  retGanancias1: number
  /** Anulado en Colppy: no cuenta, pero su base quedó dentro de la acumulada de los pagos posteriores */
  anulado?: boolean
}

export interface CalculoRetencion {
  regimen: string
  /** Neto sin IVA de lo que se paga en esta OP */
  baseEstePago: number
  /** Base acumulada de pagos anteriores del mes */
  basePrevia: number
  /** Retenido en pagos anteriores del mes */
  retenidoPrevio: number
  /** Lo que va en baseCalculo1 del alta */
  baseAcumulada: number
  /** Lo que va en retGanancias1 del alta */
  retencion: number
  minimoNoSujeto: number
  alicuota: number
  avisos: string[]
}

export function netoDeFactura(f: NetoFactura): number {
  if (!(f.totalFactura > 0)) return 0
  return (f.estePago * (f.netoGravado + f.netoNoGravado)) / f.totalFactura
}

/**
 * Base y retenido de los pagos anteriores del mes (solo los del régimen 78).
 * Colppy guarda en cada pago la base ACUMULADA del mes, así que normalmente
 * vale la del último. Con pagos anulados en el medio, la base de los
 * posteriores todavía incluye la del anulado: se reconstruye el neto propio de
 * cada pago (su base menos la del anterior, por número) y se suman solo los
 * vigentes.
 */
export function acumuladoPrevio(previos: PagoPrevioMes[]): { basePrevia: number; retenidoPrevio: number; avisos: string[] } {
  const avisos: string[] = []
  const del78 = previos.filter((p) => p.idRetGanancias1 === REGIMEN_78.codigo)
  const vigentes78 = del78.filter((p) => !p.anulado)
  const sinRegimen = previos.filter((p) => p.idRetGanancias1 !== REGIMEN_78.codigo && !p.anulado)
  if (sinRegimen.length) {
    avisos.push(
      `Este mes hay ${sinRegimen.length} pago(s) a este proveedor sin retención de Ganancias (${sinRegimen.map((p) => p.nroPago).join(', ')}): no suman a la base acumulada. Revisá la retención contra Colppy.`
    )
  }
  const retenidoPrevio = r2(vigentes78.reduce((a, p) => a + p.retGanancias1, 0))
  const anulados78 = del78.filter((p) => p.anulado)
  if (!anulados78.length) {
    return { basePrevia: r2(Math.max(0, ...vigentes78.map((p) => p.baseCalculo1))), retenidoPrevio, avisos }
  }

  const ordenados = [...del78].sort((a, b) => a.nroPago.localeCompare(b.nroPago))
  const monotonos = ordenados.every((p, i) => i === 0 || p.baseCalculo1 >= ordenados[i - 1].baseCalculo1 - 0.005)
  avisos.push(
    `Este mes hay ${anulados78.length} pago(s) anulado(s) a este proveedor (${anulados78.map((p) => p.nroPago).join(', ')}): revisá la retención contra Colppy.`
  )
  if (!monotonos) {
    avisos.push('Las bases guardadas en Colppy no van creciendo: se tomó la mayor de los pagos vigentes. Revisala a mano.')
    return { basePrevia: r2(Math.max(0, ...vigentes78.map((p) => p.baseCalculo1))), retenidoPrevio, avisos }
  }
  let anterior = 0
  let basePrevia = 0
  for (const p of ordenados) {
    const propio = p.baseCalculo1 - anterior
    anterior = p.baseCalculo1
    if (!p.anulado) basePrevia += propio
  }
  return { basePrevia: r2(basePrevia), retenidoPrevio, avisos }
}

export function calcularRetencion78(facturas: NetoFactura[], previos: PagoPrevioMes[]): CalculoRetencion {
  const { basePrevia, retenidoPrevio, avisos } = acumuladoPrevio(previos)
  const baseEstePago = r2(facturas.reduce((a, f) => a + netoDeFactura(f), 0))
  const baseAcumulada = r2(basePrevia + baseEstePago)
  const totalMes = baseAcumulada > REGIMEN_78.minimoNoSujeto ? r2((baseAcumulada - REGIMEN_78.minimoNoSujeto) * REGIMEN_78.alicuota) : 0
  const retencion = Math.max(0, r2(totalMes - retenidoPrevio))
  return {
    regimen: REGIMEN_78.codigo,
    baseEstePago,
    basePrevia,
    retenidoPrevio,
    baseAcumulada,
    retencion,
    minimoNoSujeto: REGIMEN_78.minimoNoSujeto,
    alicuota: REGIMEN_78.alicuota,
    avisos,
  }
}

import { prisma } from '@/lib/prisma'

/**
 * Cálculo de comisiones de vendedores.
 *
 * Regla central: la comisión es MENSUAL sobre lo facturado. El total facturado
 * USD del mes define UN único tramo de la escala que se aplica a todas las
 * ventas facturadas de ese mes (no es tasa por venta). Por eso la comisión de
 * una venta es provisoria hasta el cierre de la liquidación: una factura más
 * a fin de mes puede empujar el tramo de todo el mes.
 *
 * Lo "cerrado" (cotización aprobada sin facturar) es forecast en USD: no se
 * paga, no aplica TC y NO empuja el tramo.
 */

/**
 * Primer mes que se liquida en el ERP. Todo lo anterior vive en la planilla
 * Excel de siempre (decisión 2026-07-20: no se migra el historial, que llega
 * hasta Junio; Julio arranca en el ERP para probar el circuito completo).
 */
export const COMISIONES_INICIO = { anio: 2026, mes: 7 }

export function mesHabilitado(anio: number, mes: number): boolean {
  return (
    anio > COMISIONES_INICIO.anio ||
    (anio === COMISIONES_INICIO.anio && mes >= COMISIONES_INICIO.mes)
  )
}

export interface TramoEscala {
  pisoUsd: number
  techoUsd: number | null // null = sin techo
  tasa: number
}

// Escala por defecto (vigente desde Julio 2026, decisión 2026-08-04: aplica
// también retroactivo a Julio; la anterior arrancaba en 1% con tramos de
// 50/75/100k). Se usa como fallback si la tabla comision_escalas está vacía.
export const ESCALA_DEFAULT: TramoEscala[] = [
  { pisoUsd: 0, techoUsd: 20000, tasa: 0.0125 },
  { pisoUsd: 20000, techoUsd: 40000, tasa: 0.015 },
  { pisoUsd: 40000, techoUsd: 60000, tasa: 0.0175 },
  { pisoUsd: 60000, techoUsd: null, tasa: 0.02 },
]

/**
 * Escala vigente para un mes, desde la DB (fallback: ESCALA_DEFAULT).
 * Rige el set de tramos con el mayor vigenteDesde anterior al fin del mes,
 * así un futuro cambio de escala no pisa meses anteriores todavía abiertos.
 */
export async function getEscala(anio: number, mes: number): Promise<TramoEscala[]> {
  // mes es 1-12 y Date.UTC usa 0-11 → esto da el primer instante del mes siguiente.
  const finDeMes = new Date(Date.UTC(anio, mes, 1))
  const tramos = await prisma.comisionEscala.findMany({
    where: { vigenteDesde: { lt: finDeMes } },
    orderBy: [{ vigenteDesde: 'desc' }, { pisoUsd: 'asc' }],
  })
  if (tramos.length === 0) return ESCALA_DEFAULT
  const corte = tramos[0].vigenteDesde.getTime()
  return tramos.filter((t) => t.vigenteDesde.getTime() === corte).map((t) => ({
    pisoUsd: Number(t.pisoUsd),
    techoUsd: t.techoUsd === null ? null : Number(t.techoUsd),
    tasa: Number(t.tasa),
  }))
}

/**
 * Tramo que corresponde a un total facturado USD del mes.
 * Bordes: piso inclusivo, techo exclusivo → 20.000 exacto paga 1,50%
 * (en la planilla `Menos $20000` es exclusivo: 20.000 ya sale del primer tramo).
 */
export function tasaParaTotal(totalUsd: number, escala: TramoEscala[]): number {
  for (const tramo of escala) {
    const dentroPiso = totalUsd >= tramo.pisoUsd
    const dentroTecho = tramo.techoUsd === null || totalUsd < tramo.techoUsd
    if (dentroPiso && dentroTecho) return tramo.tasa
  }
  // Total negativo o escala mal cargada: usar el primer tramo.
  return escala[0]?.tasa ?? 0
}

export type TipoOperacion = 'BILLETE' | 'DIVISA'

export interface TipoCambioDelMes {
  billete: number | null
  divisa: number | null
}

/** TC del mes desde tipo_cambio_meses (null si no está cargado). */
export async function getTipoCambioMes(anio: number, mes: number): Promise<TipoCambioDelMes> {
  const tc = await prisma.tipoCambioMes.findUnique({
    where: { anio_mes: { anio, mes } },
  })
  return {
    billete: tc ? Number(tc.billete) : null,
    divisa: tc ? Number(tc.divisa) : null,
  }
}

export function tcParaOperacion(tc: TipoCambioDelMes, tipo: TipoOperacion): number | null {
  return tipo === 'DIVISA' ? tc.divisa : tc.billete
}

export const redondear2 = (n: number) => Math.round(n * 100) / 100

/**
 * Comisión de una línea facturada.
 * comisionUsd = importeFacturadoUsd × tasaMes
 * comisionArs = comisionUsd × TC(mes, tipoOperacion)
 * Si no hay TC disponible, comisionArs queda null (la UI lo señala).
 */
export function calcularComisionLinea(
  importeFacturadoUsd: number,
  tasaMes: number,
  tipoCambio: number | null
): { comisionUsd: number; comisionArs: number | null } {
  const comisionUsd = redondear2(importeFacturadoUsd * tasaMes)
  const comisionArs = tipoCambio === null ? null : redondear2(importeFacturadoUsd * tasaMes * tipoCambio)
  return { comisionUsd, comisionArs }
}

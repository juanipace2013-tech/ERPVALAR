/**
 * Reglas del módulo Vacaciones.
 *
 * Edición: solo los que aprueban las vacaciones (Santiago y Juan).
 * El resto de los usuarios puede VER la planilla.
 */

export const VACACIONES_EDITORES = (
  process.env.VACACIONES_EDITORES || 'stejedor@val-ar.com.ar,jpace@val-ar.com.ar'
)
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

export function puedeEditarVacaciones(email?: string | null): boolean {
  return !!email && VACACIONES_EDITORES.includes(email.toLowerCase())
}

/**
 * Días de vacaciones que corresponden por LCT (art. 150), según la
 * antigüedad computada al 31/12 del año dado:
 *   hasta 5 años → 14 · más de 5 → 21 · más de 10 → 28 · más de 20 → 35
 * (Si la antigüedad al 31/12 es menor a 6 meses corresponde 1 día cada 20
 * trabajados — se muestra 14 como referencia y se ajusta a mano si hace falta.)
 */
export function diasVacacionesLct(fechaIngreso: Date, anio: number): number {
  const cierre = Date.UTC(anio, 11, 31)
  const anios = (cierre - fechaIngreso.getTime()) / (365.25 * 24 * 3600 * 1000)
  if (anios > 20) return 35
  if (anios > 10) return 28
  if (anios > 5) return 21
  return 14
}

/**
 * El saldo se calcula desde este año (primer año con historial completo y
 * confiable en el ERP). Lo anterior entra por Empleado.ajusteSaldo.
 */
export const SALDO_ANIO_BASE = 2025

export interface SaldoDetalleAnio {
  anio: number
  corresponden: number
  tomados: number
  /** false = los días de este año todavía no se activaron (arrancan el 1/10, LCT art. 154) */
  activado: boolean
}

/**
 * Saldo de vacaciones al día de HOY:
 *   ajuste (arrastre pre-2025 / correcciones) + Σ corresponden por LCT de los
 *   años ACTIVADOS − todas las V registradas (pasadas y futuras) desde 2025.
 *
 * Los días del año en curso se activan el 1° de octubre (el período legal de
 * otorgamiento va del 1/10 al 30/4 del año siguiente — LCT art. 154).
 */
export function computarSaldo(opts: {
  fechaIngreso: Date
  ajusteSaldo: number
  hoy: Date
  vTomadasPorAnio: Map<number, number>
}): { saldo: number; detalle: SaldoDetalleAnio[]; proximaActivacion: { anio: number; dias: number } | null } {
  const anioActual = opts.hoy.getUTCFullYear()
  const desde = Math.max(SALDO_ANIO_BASE, opts.fechaIngreso.getUTCFullYear())
  const detalle: SaldoDetalleAnio[] = []
  let saldo = opts.ajusteSaldo
  let proximaActivacion: { anio: number; dias: number } | null = null

  for (let anio = desde; anio <= anioActual; anio++) {
    const corresponden = diasVacacionesLct(opts.fechaIngreso, anio)
    const activado = anio < anioActual || opts.hoy.getTime() >= Date.UTC(anio, 9, 1)
    if (activado) saldo += corresponden
    else proximaActivacion = { anio, dias: corresponden }
    detalle.push({ anio, corresponden, tomados: opts.vTomadasPorAnio.get(anio) ?? 0, activado })
  }
  // Todas las V descuentan (incluidas las cargadas a futuro: ya están comprometidas)
  for (const n of opts.vTomadasPorAnio.values()) saldo -= n
  return { saldo, detalle, proximaActivacion }
}

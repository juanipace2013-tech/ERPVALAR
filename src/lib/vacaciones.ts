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

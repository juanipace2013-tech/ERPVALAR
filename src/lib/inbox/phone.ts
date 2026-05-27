/**
 * Normalización de teléfonos para matching en la bandeja.
 *
 * WhatsApp Cloud API entrega los teléfonos en E.164 sin "+" (ej: "5491140404040").
 * Los teléfonos cargados en el CRM están en formatos variados:
 *   "11-4040-4040", "+54 9 11 4040 4040", "(011) 4040-4040", "15 4040 4040", etc.
 *
 * Para matchear, reducimos a un "key" canónico: los últimos 10 dígitos
 * (número AR sin prefijo internacional ni "9" de móvil).
 */

/** Devuelve solo los dígitos del input. */
export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '')
}

/**
 * Devuelve los últimos 10 dígitos del teléfono.
 * Sirve como clave de matching independiente del formato.
 * Para AR esto deja `<área><número>` sin "54" ni "9".
 */
export function phoneMatchKey(input: string | null | undefined): string | null {
  if (!input) return null
  const digits = digitsOnly(input)
  if (digits.length < 8) return null
  // Quitar prefijo país 54 si aparece al inicio
  let core = digits
  if (core.startsWith('54')) core = core.slice(2)
  // Quitar el 9 de móvil
  if (core.startsWith('9')) core = core.slice(1)
  // Quitar 0 inicial (formato local AR)
  if (core.startsWith('0')) core = core.slice(1)
  // Quitar 15 viejo (sólo cuando el resto tiene pinta de móvil)
  if (core.startsWith('15') && core.length > 10) core = core.slice(2)
  // Tomamos los últimos 10 — suficiente para distinguir nº locales argentinos
  return core.slice(-10)
}

/**
 * Convierte un teléfono al formato E.164 que usa la WhatsApp Cloud API
 * (sin "+", con 54 y, para móviles, el "9" requerido por WA).
 * Asumimos móvil por default cuando no se puede determinar — es el caso
 * en el que se va a usar para mandar mensajes.
 */
export function toWhatsAppE164(input: string): string | null {
  const key = phoneMatchKey(input)
  if (!key) return null
  return `549${key}`
}

// Referencia interna del cliente por ítem de cotización: SOLPED, N° de
// requisición, TAG, código de material... (ej. Minera Exar:
// "SOLPED 3000001204 · Pos. 30 · Mat. 8009384"). Texto libre: cada cliente
// usa su propio formato.

export const CLIENT_REFERENCE_MAX = 200

const ETIQUETA = 'Ref. cliente:'

/** Limpia el valor que llega del formulario/API. Vacío → null. */
export function normalizeClientReference(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const limpio = value.replace(/\s+/g, ' ').trim()
  return limpio ? limpio.slice(0, CLIENT_REFERENCE_MAX) : null
}

/**
 * Agrega la referencia del cliente al final de la descripción de una línea de
 * remito o factura. Idempotente: si la descripción ya la trae (porque se
 * precargó así en el diálogo y el usuario no la tocó), no la duplica.
 */
export function withClientReference(description: string, clientReference?: string | null): string {
  const ref = clientReference?.trim()
  if (!ref) return description
  if (description.includes(ref)) return description
  return `${description} - ${ETIQUETA} ${ref}`
}

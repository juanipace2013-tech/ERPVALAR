/**
 * Plazo de entrega de un ítem de orden de compra: texto libre ("6 semanas",
 * "Inmediato"). Se guarda recortado a 100 caracteres; vacío = sin plazo (null).
 */
export function plazoEntregaItem(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const limpio = valor.replace(/\s+/g, ' ').trim().slice(0, 100)
  return limpio || null
}

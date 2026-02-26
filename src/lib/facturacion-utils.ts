/**
 * Utilidades para el módulo de Facturación (Kanban board)
 */

/**
 * Determina si un ítem está en stock basándose en el campo deliveryTime.
 * "Inmediato" (case-insensitive), null o vacío = en stock.
 */
export function isItemInStock(deliveryTime: string | null | undefined): boolean {
  if (!deliveryTime) return true
  const normalized = deliveryTime.trim().toLowerCase()
  return normalized === 'inmediato' || normalized === 'inmediata' || normalized === 'stock'
}

/**
 * Parsea el plazo de entrega y devuelve días numéricos.
 * Retorna 0 para "Inmediato", null para texto no parseable, o el número de días.
 */
export function parseDeliveryDays(deliveryTime: string | null | undefined): number | null {
  if (!deliveryTime) return 0
  const normalized = deliveryTime.trim().toLowerCase()
  if (normalized === 'inmediato' || normalized === 'inmediata' || normalized === 'stock') return 0

  // Patrones: "7 dias", "15 días", "30 días hábiles", "7-10 días"
  const rangeMatch = normalized.match(/(\d+)\s*[-a]\s*(\d+)\s*d[ií]as?/)
  if (rangeMatch) return parseInt(rangeMatch[2], 10) // Tomar el mayor

  const match = normalized.match(/(\d+)\s*d[ií]as?/)
  if (match) return parseInt(match[1], 10)

  // "A confirmar", "Consultar", etc.
  return null
}

export type KanbanColumn = 'ready' | 'partial' | 'pending'

/**
 * Clasifica una cotización en una columna del Kanban según la disponibilidad de sus ítems.
 * Solo considera ítems no-alternativos.
 */
export function classifyQuote(
  items: Array<{ deliveryTime: string | null; isAlternative: boolean }>
): KanbanColumn {
  const mainItems = items.filter((i) => !i.isAlternative)
  if (mainItems.length === 0) return 'pending'

  const readyCount = mainItems.filter((i) => isItemInStock(i.deliveryTime)).length

  if (readyCount === mainItems.length) return 'ready'
  if (readyCount === 0) return 'pending'
  return 'partial'
}

/**
 * Obtiene el plazo de entrega más lejano de los ítems de una cotización.
 */
export function getFarthestDelivery(
  items: Array<{ deliveryTime: string | null; isAlternative: boolean }>
): string {
  const mainItems = items.filter((i) => !i.isAlternative)
  let maxDays = 0
  let hasUnparseable = false

  for (const item of mainItems) {
    const days = parseDeliveryDays(item.deliveryTime)
    if (days === null) {
      hasUnparseable = true
    } else if (days > maxDays) {
      maxDays = days
    }
  }

  if (maxDays === 0 && !hasUnparseable) return 'Inmediato'
  if (hasUnparseable && maxDays === 0) return 'A confirmar'
  if (maxDays > 0) return `${maxDays} días`
  return 'A confirmar'
}

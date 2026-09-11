/**
 * Condición de pago de una factura de compra en el formato que usa Colppy
 * ("a 30 Dias", "Contado"). Compartido por la carga manual (UI) y la carga
 * automática desde el mail de facturación.
 */

export const VALID_PAYMENT_DAYS = [7, 15, 30, 45, 60, 90, 120, 150, 180]

function closestPaymentDays(dias: number): number {
  return VALID_PAYMENT_DAYS.reduce((prev, curr) =>
    Math.abs(curr - dias) < Math.abs(prev - dias) ? curr : prev
  )
}

/**
 * Normaliza el texto de condición de pago del OCR al formato de Colppy.
 * Ej: "CUENTA CORRIENTE 30 DIAS" → "a 30 Dias"
 *     "Contado" → "Contado"
 */
export function normalizePaymentTerm(raw: string): string {
  if (!raw) return ''
  const lower = raw.toLowerCase()

  // Buscar número de días PRIMERO (prioridad sobre "contado"/"efectivo")
  // porque textos como "30 DIAS FF ... EFECTIVO PAGO" deben ser "a 30 Dias"
  const match = lower.match(/(\d+)\s*d[ií]as?/)
  if (match) {
    return `a ${closestPaymentDays(parseInt(match[1]))} Dias`
  }

  // Si tiene solo un número
  const numMatch = lower.match(/\b(\d+)\b/)
  if (numMatch) {
    const dias = parseInt(numMatch[1])
    if (dias >= 7 && dias <= 180) {
      return `a ${closestPaymentDays(dias)} Dias`
    }
  }

  // Contado / efectivo (solo si no se detectaron días arriba)
  if (lower.includes('contado') || lower.includes('efectivo')) return 'Contado'

  // Si dice "cuenta corriente" sin número, asumir 30 días
  if (lower.includes('cuenta corriente') || lower.includes('cta cte')) return 'a 30 Dias'

  return ''
}

/** Días de plazo de una condición ya normalizada ("a 30 Dias" → 30, "Contado" → 0). */
export function paymentTermDays(normalized: string): number | null {
  if (!normalized) return null
  if (normalized === 'Contado') return 0
  const m = normalized.match(/(\d+)/)
  return m ? parseInt(m[1]) : null
}

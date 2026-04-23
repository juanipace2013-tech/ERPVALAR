/**
 * Motivos canónicos por los que una factura de compra puede requerir revisión
 * manual antes de operaciones que dependen de datos consistentes (ej. envío a
 * Colppy, impacto en stock, libro IVA).
 *
 * Representación en DB:
 *   - `PurchaseInvoice.requiresReview: Boolean`  → flag denormalizado indexable para filtros de lista
 *   - `PurchaseInvoice.reviewReason:   String?`  → motivo específico (null = no requiere review)
 *
 * Usamos String (no enum Prisma) porque los motivos crecen con el producto:
 * sumar uno nuevo NO requiere migración, sólo agregarlo a este archivo.
 */

export const REVIEW_REASONS = {
  /** El OCR no pudo determinar con confianza la jurisdicción de alguna percepción IIBB. */
  IIBB_JURISDICTION: 'iibb_jurisdiction',
  /** El total declarado no coincide con la suma de ítems/IVA/percepciones calculada. */
  AMOUNT_MISMATCH: 'amount_mismatch',
  /** El CUIT detectado no valida o no coincide con el proveedor. */
  CUIT_MISMATCH: 'cuit_mismatch',
  /** La descripción/encabezado de una percepción es ambigua y no se pudo clasificar. */
  AMBIGUOUS_PERCEPTION: 'ambiguous_perception',
} as const

export type ReviewReason = (typeof REVIEW_REASONS)[keyof typeof REVIEW_REASONS]

/** Etiqueta humana para mostrar en badges/listas. */
export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  iibb_jurisdiction: 'Revisar jurisdicción IIBB',
  amount_mismatch: 'Revisar totales',
  cuit_mismatch: 'Revisar CUIT',
  ambiguous_perception: 'Revisar percepción',
}

/** `true` si el string es un motivo conocido. Útil para validar input antes de persistir. */
export function isReviewReason(value: unknown): value is ReviewReason {
  return typeof value === 'string' && (Object.values(REVIEW_REASONS) as string[]).includes(value)
}

/**
 * Devuelve la etiqueta humana de un reviewReason, o un fallback genérico si
 * el valor persistido no está en la lista canónica (permite valores históricos
 * o añadidos ad-hoc sin romper la UI).
 */
export function reviewReasonLabel(reason: string | null | undefined): string {
  if (!reason) return ''
  if (isReviewReason(reason)) return REVIEW_REASON_LABELS[reason]
  return 'Revisar factura'
}

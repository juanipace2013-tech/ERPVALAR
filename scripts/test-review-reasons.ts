/**
 * Tests del helper `review-reasons`.
 *
 * Correr con:
 *   npx tsx scripts/test-review-reasons.ts
 */

import {
  REVIEW_REASONS,
  REVIEW_REASON_LABELS,
  isReviewReason,
  reviewReasonLabel,
} from '../src/lib/review-reasons'

let passed = 0
let failed = 0

function assertEq<T>(desc: string, actual: T, expected: T) {
  if (actual === expected) {
    passed++
    console.log(`  ✓ ${desc}`)
  } else {
    failed++
    console.error(
      `  ✗ ${desc}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`
    )
  }
}

// Valores canónicos existen y son strings snake_case
assertEq('IIBB_JURISDICTION', REVIEW_REASONS.IIBB_JURISDICTION, 'iibb_jurisdiction')
assertEq('AMOUNT_MISMATCH', REVIEW_REASONS.AMOUNT_MISMATCH, 'amount_mismatch')
assertEq('CUIT_MISMATCH', REVIEW_REASONS.CUIT_MISMATCH, 'cuit_mismatch')
assertEq('AMBIGUOUS_PERCEPTION', REVIEW_REASONS.AMBIGUOUS_PERCEPTION, 'ambiguous_perception')

// Todas las razones tienen label humano
for (const reason of Object.values(REVIEW_REASONS)) {
  const label = REVIEW_REASON_LABELS[reason]
  if (label && label.length > 0) {
    passed++
    console.log(`  ✓ label definido para "${reason}": "${label}"`)
  } else {
    failed++
    console.error(`  ✗ label faltante o vacío para "${reason}"`)
  }
}

// isReviewReason — positivos
assertEq('isReviewReason("iibb_jurisdiction")', isReviewReason('iibb_jurisdiction'), true)
assertEq('isReviewReason("amount_mismatch")', isReviewReason('amount_mismatch'), true)
// isReviewReason — negativos
assertEq('isReviewReason("invalid_reason")', isReviewReason('invalid_reason'), false)
assertEq('isReviewReason("")', isReviewReason(''), false)
assertEq('isReviewReason(null)', isReviewReason(null), false)
assertEq('isReviewReason(undefined)', isReviewReason(undefined), false)
assertEq('isReviewReason(123)', isReviewReason(123), false)

// reviewReasonLabel
assertEq(
  'reviewReasonLabel("iibb_jurisdiction")',
  reviewReasonLabel('iibb_jurisdiction'),
  'Revisar jurisdicción IIBB'
)
assertEq('reviewReasonLabel(null)', reviewReasonLabel(null), '')
assertEq('reviewReasonLabel(undefined)', reviewReasonLabel(undefined), '')
assertEq('reviewReasonLabel("")', reviewReasonLabel(''), '')
// Valor desconocido → fallback genérico (permite forward-compat si se añade una razón
// nueva al server antes que al cliente)
assertEq(
  'reviewReasonLabel("unknown_reason") → fallback',
  reviewReasonLabel('unknown_reason'),
  'Revisar factura'
)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)

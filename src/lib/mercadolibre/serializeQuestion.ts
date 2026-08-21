import type { MlQuestion } from '@prisma/client'

/** Serializa una MlQuestion para la UI (BigInt/Decimal/Date -> JSON). */
export function serializeQuestion(q: MlQuestion) {
  return {
    id: q.id,
    mlQuestionId: q.mlQuestionId.toString(),
    mlItemId: q.mlItemId,
    itemTitle: q.itemTitle,
    itemSku: q.itemSku,
    productId: q.productId,
    questionText: q.questionText,
    askedAt: q.askedAt?.toISOString() ?? null,
    status: q.status,
    draftAnswer: q.draftAnswer,
    answerText: q.answerText,
    answeredAt: q.answeredAt?.toISOString() ?? null,
    needsReview: q.needsReview,
    reviewReason: q.reviewReason,
    errorDetail: q.errorDetail,
    aiCostUsd: q.aiCostUsd ? Number(q.aiCostUsd) : null,
    createdAt: q.createdAt.toISOString(),
  }
}

export type SerializedQuestion = ReturnType<typeof serializeQuestion>

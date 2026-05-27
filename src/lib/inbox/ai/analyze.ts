/**
 * Orquestador del análisis IA de una conversación.
 *
 * Flujo:
 *   1. Trae la conversación con los últimos 10 mensajes y el customer linkeado.
 *   2. Identifica el último INBOUND — ese es el "mensaje a responder".
 *   3. Clasificador (Haiku) sobre ese mensaje.
 *   4. Drafter (Sonnet) sobre el thread + categoría detectada.
 *   5. Persiste resultados en Conversation (sobrescribe el análisis anterior).
 *
 * Idempotencia: si ya hay un aiAnalyzedMessageId == último inbound, devuelve
 * AlreadyAnalyzed sin pegarle a la API (a menos que force=true).
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { ChannelType } from '@prisma/client'
import { classifyMessage } from './classifier'
import { draftReply, type DrafterMessage } from './drafter'

const MAX_THREAD_MESSAGES = 10

export type AnalyzeOutcome =
  | { status: 'ANALYZED'; conversationId: string }
  | { status: 'ALREADY_ANALYZED'; conversationId: string; lastAnalyzedMessageId: string }
  | { status: 'NO_INBOUND'; conversationId: string }

export async function analyzeConversation(
  conversationId: string,
  opts: { force?: boolean } = {}
): Promise<AnalyzeOutcome> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      channelAccount: { select: { type: true } },
      customer: { select: { name: true } },
      messages: {
        orderBy: { sentAt: 'desc' },
        take: MAX_THREAD_MESSAGES,
      },
    },
  })

  if (!conversation) throw new Error(`Conversación no encontrada: ${conversationId}`)

  // Mensajes en orden ascendente, el último (más nuevo) al final
  const threadAsc = [...conversation.messages].reverse()
  const lastInbound = [...threadAsc].reverse().find((m) => m.direction === 'INBOUND')

  if (!lastInbound) {
    return { status: 'NO_INBOUND', conversationId }
  }

  // Idempotencia
  if (!opts.force && conversation.aiAnalyzedMessageId === lastInbound.id) {
    return {
      status: 'ALREADY_ANALYZED',
      conversationId,
      lastAnalyzedMessageId: lastInbound.id,
    }
  }

  const channelType = conversation.channelAccount.type === ChannelType.WHATSAPP ? 'WHATSAPP' : 'EMAIL'

  logger.info(
    `[ai/analyze] Analizando conversación ${conversationId} canal=${channelType} msgId=${lastInbound.id}`
  )

  // 1. Clasificar
  const classifier = await classifyMessage({
    messageBody: lastInbound.body,
    channelType,
    subject: conversation.subject,
    contactName: lastInbound.fromName,
  })

  // 2. Redactar (secuencial — la categoría alimenta el drafter)
  const threadForDraft: DrafterMessage[] = threadAsc.map((m) => ({
    direction: m.direction,
    body: m.body || '',
    fromName: m.fromName,
    sentAt: m.sentAt,
  }))

  const drafter = await draftReply({
    category: classifier.category,
    categorySummary: classifier.summary,
    channelType,
    thread: threadForDraft,
    contactName: conversation.contactName,
    customerName: conversation.customer?.name ?? null,
    subject: conversation.subject,
  })

  const totalCost = classifier.costUsd + drafter.costUsd

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      aiCategory: classifier.category,
      aiCategoryConfidence: classifier.confidence,
      aiSummary: classifier.summary,
      aiDraftReply: drafter.draft,
      aiClassifierModel: classifier.model,
      aiDrafterModel: drafter.model,
      aiCostUsd: totalCost,
      aiAnalyzedAt: new Date(),
      aiAnalyzedMessageId: lastInbound.id,
    },
  })

  logger.info(
    `[ai/analyze] Listo conversación=${conversationId} cat=${classifier.category} conf=${classifier.confidence.toFixed(2)} cost=$${totalCost.toFixed(4)}`
  )

  return { status: 'ANALYZED', conversationId }
}

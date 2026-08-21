/**
 * Preguntas pre-venta de Mercado Libre.
 *
 * Flujo por notificación (topic "questions"):
 *   1. Extraer el questionId del resource ("/questions/123") y traer la pregunta.
 *   2. Gatear: solo status UNANSWERED.
 *   3. Idempotencia por mlQuestionId (UNIQUE en MlQuestion).
 *   4. Traer ítem + descripción + respuestas previas del ítem; mapear el
 *      seller_custom_field al Product del ERP por SKU.
 *   5. Generar borrador con Claude.
 *   6. Según ML_QUESTIONS_MODE:
 *        REVIEW (default): queda PENDING_REVIEW.
 *        AUTO: si la IA NO pidió revisión, se publica directo.
 *
 * publishAnswer() se reutiliza desde el endpoint manual (con el texto editado).
 * syncUnansweredQuestions() hace backfill de lo que haya sin responder en la
 * cuenta (por si se perdieron notificaciones o para el arranque).
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { MlQuestionStatus, type MlQuestion as MlQuestionRow } from '@prisma/client'
import {
  getQuestion,
  getItem,
  getItemDescription,
  getItemAnsweredQuestions,
  getMyUnansweredQuestions,
  postAnswer,
  MlApiError,
  type MlItem,
  type MlQuestion,
} from './client'
import { generateAnswer, ML_ANSWER_MAX_CHARS, type ErpProductContext } from './answerAi'

export function parseQuestionId(resource: string): string | null {
  const m = resource.match(/\/questions\/(\d+)/)
  return m ? m[1] : null
}

function isAutoMode(): boolean {
  return (process.env.ML_QUESTIONS_MODE ?? 'REVIEW').toUpperCase() === 'AUTO'
}

/** SKU de la publicación: el del ítem o, si no, el de la primera variación que lo tenga. */
function resolveItemSku(item: MlItem): string | null {
  if (item.seller_custom_field) return item.seller_custom_field
  const v = (item.variations ?? []).find((x) => x.seller_custom_field)
  return v?.seller_custom_field ?? null
}

async function findErpProduct(sku: string | null) {
  if (!sku) return null
  const clean = sku.trim()
  return prisma.product.findFirst({
    where: { OR: [{ sku: clean }, { sku: { equals: clean, mode: 'insensitive' } }] },
    select: {
      id: true,
      sku: true,
      name: true,
      brand: true,
      description: true,
      stockQuantity: true,
      unit: true,
    },
  })
}

/**
 * Genera (o regenera) el borrador para una pregunta ya persistida y lo guarda.
 * Devuelve el registro actualizado. No publica.
 */
export async function draftAnswerFor(row: MlQuestionRow): Promise<MlQuestionRow> {
  const [question, item, desc, prev] = await Promise.all([
    getQuestion(row.mlQuestionId.toString()),
    getItem(row.mlItemId),
    getItemDescription(row.mlItemId).catch(() => null),
    getItemAnsweredQuestions(row.mlItemId).catch(() => ({ questions: [] as MlQuestion[] })),
  ])

  const sku = resolveItemSku(item)
  const product = await findErpProduct(sku)
  const productCtx: ErpProductContext | null = product
    ? {
        sku: product.sku,
        name: product.name,
        brand: product.brand,
        description: product.description,
        stockQuantity: product.stockQuantity,
        unit: product.unit,
      }
    : null

  const ai = await generateAnswer({
    question,
    item,
    itemDescription: desc?.plain_text ?? null,
    product: productCtx,
    previousAnswered: (prev.questions ?? []).filter((q) => q.id !== question.id),
  })

  return prisma.mlQuestion.update({
    where: { id: row.id },
    data: {
      itemTitle: item.title,
      itemSku: sku,
      productId: product?.id ?? null,
      draftAnswer: ai.answer,
      needsReview: ai.needsReview,
      reviewReason: ai.reviewReason,
      aiModel: ai.model,
      aiCostUsd: ai.costUsd,
      errorDetail: null,
    },
  })
}

/**
 * Publica la respuesta en ML y actualiza el registro (ANSWERED / FAILED).
 */
export async function publishAnswer(
  row: MlQuestionRow,
  text: string,
  answeredById: string | null
): Promise<MlQuestionRow> {
  const clean = text.trim().slice(0, ML_ANSWER_MAX_CHARS)
  try {
    await postAnswer(row.mlQuestionId.toString(), clean)
    logger.info(`[ML Preguntas] Respondida question=${row.mlQuestionId}`)
    return prisma.mlQuestion.update({
      where: { id: row.id },
      data: {
        status: MlQuestionStatus.ANSWERED,
        answerText: clean,
        answeredAt: new Date(),
        answeredById,
        errorDetail: null,
      },
    })
  } catch (err) {
    const detail = err instanceof MlApiError ? JSON.stringify(err.body) : String(err)
    logger.error(`[ML Preguntas] Error respondiendo question=${row.mlQuestionId}`, detail)
    // Si ML dice que la pregunta ya no está (borrada/cerrada), la cerramos.
    const closed =
      err instanceof MlApiError &&
      (err.status === 404 || /closed|deleted|already answered/i.test(detail))
    return prisma.mlQuestion.update({
      where: { id: row.id },
      data: {
        status: closed ? MlQuestionStatus.CLOSED : MlQuestionStatus.FAILED,
        errorDetail: `API error: ${detail}`.slice(0, 1000),
      },
    })
  }
}

/**
 * Ingresa una pregunta de ML al ERP: crea el registro (idempotente), genera el
 * borrador y, en modo AUTO sin revisión, la publica. Devuelve el registro o
 * null si se salteó.
 */
export async function ingestQuestion(question: MlQuestion): Promise<MlQuestionRow | null> {
  if (question.status !== 'UNANSWERED') {
    logger.info(`[ML Preguntas] question=${question.id} status=${question.status}, skip`)
    return null
  }

  let row: MlQuestionRow
  try {
    row = await prisma.mlQuestion.create({
      data: {
        mlQuestionId: BigInt(question.id),
        mlItemId: question.item_id,
        buyerId: question.from?.id != null ? BigInt(question.from.id) : null,
        questionText: question.text,
        askedAt: question.date_created ? new Date(question.date_created) : null,
        status: MlQuestionStatus.PENDING_REVIEW,
      },
    })
  } catch {
    // UNIQUE violado: ya la tenemos (notificación repetida o carrera).
    logger.info(`[ML Preguntas] question=${question.id} ya existe, skip`)
    return null
  }

  try {
    row = await draftAnswerFor(row)
  } catch (err) {
    logger.error(`[ML Preguntas] Error generando borrador question=${question.id}`, err)
    return prisma.mlQuestion.update({
      where: { id: row.id },
      data: { errorDetail: `IA: ${String(err)}`.slice(0, 1000) },
    })
  }

  if (isAutoMode() && !row.needsReview && row.draftAnswer) {
    return publishAnswer(row, row.draftAnswer, null)
  }
  return row
}

/**
 * Procesa una notificación del webhook (topic "questions"). Idempotente.
 */
export async function handleQuestionNotification(notificationId: string): Promise<void> {
  const notif = await prisma.mlNotification.findUnique({ where: { id: notificationId } })
  if (!notif || notif.processed) return

  const markProcessed = () =>
    prisma.mlNotification.update({
      where: { id: notif.id },
      data: { processed: true, attempts: { increment: 1 } },
    })

  const questionId = parseQuestionId(notif.resource)
  if (!questionId) {
    logger.warn(`[ML Preguntas] Resource sin questionId: ${notif.resource}`)
    await markProcessed()
    return
  }

  let question: MlQuestion
  try {
    question = await getQuestion(questionId)
  } catch (err) {
    const detail = err instanceof MlApiError ? JSON.stringify(err.body) : String(err)
    logger.error(`[ML Preguntas] Error trayendo question=${questionId}`, detail)
    // Dejamos la notificación sin procesar: ML reintenta.
    return
  }

  await ingestQuestion(question)
  await markProcessed()
}

/**
 * Backfill: trae todas las preguntas sin responder de la cuenta y las ingresa.
 * Devuelve cuántas se crearon.
 */
export async function syncUnansweredQuestions(): Promise<{ found: number; created: number }> {
  let offset = 0
  const limit = 50
  let found = 0
  let created = 0
  for (;;) {
    const page = await getMyUnansweredQuestions(limit, offset)
    const qs = page.questions ?? []
    found += qs.length
    for (const q of qs) {
      const row = await ingestQuestion(q)
      if (row) created++
    }
    if (qs.length < limit) break
    offset += limit
    if (offset > 1000) break // guardia
  }
  logger.info(`[ML Preguntas] Sync: ${found} sin responder, ${created} nuevas`)
  return { found, created }
}

/**
 * Preguntas pre-venta de Mercado Libre.
 *
 * Flujo por notificación (topic "questions"):
 *   1. Extraer el questionId del resource ("/questions/123") y traer la pregunta.
 *   2. Gatear: solo status UNANSWERED.
 *   3. Idempotencia por mlQuestionId (UNIQUE en MlQuestion).
 *   4. Traer ítem + descripción + respuestas previas del ítem; resolver el
 *      Product del ERP (vinculación de Publicaciones ML o SKU) y el texto de
 *      su ficha técnica (fuente principal para lo técnico).
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
import {
  generateAnswer,
  ML_ANSWER_MAX_CHARS,
  type ErpProductContext,
  type FamilyVariantContext,
} from './answerAi'
import { ensureTechnicalSheetText } from '@/lib/productos/fichaTecnicaText'

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

const PRODUCT_SELECT = {
  id: true,
  sku: true,
  name: true,
  brand: true,
  description: true,
  stockQuantity: true,
  unit: true,
  technicalSheetUrl: true,
  technicalSheetText: true,
  technicalSheetTextAt: true,
} as const

/**
 * Producto del ERP para una publicación: primero la vinculación de
 * Publicaciones ML (MlItemLink, que cubre los matches por title-code y los
 * manuales — la mayoría de las publicaciones no tienen seller_custom_field),
 * y si no está vinculada, por SKU de la publicación.
 */
async function findErpProduct(mlItemId: string, sku: string | null) {
  const link = await prisma.mlItemLink.findUnique({
    where: { mlItemId },
    select: { product: { select: PRODUCT_SELECT } },
  })
  if (link?.product) return link.product

  if (!sku) return null
  const clean = sku.trim()
  return prisma.product.findFirst({
    where: { OR: [{ sku: clean }, { sku: { equals: clean, mode: 'insensitive' } }] },
    select: PRODUCT_SELECT,
  })
}

/**
 * Otras medidas del mismo modelo: SKUs con el mismo prefijo antes del espacio
 * ("2415 06" -> familia "2415"), con su publicación activa en ML si la tienen.
 * Le permite a la IA responder "¿lo tienen en DN40?" con la publicación
 * correcta. SKUs sin espacio no tienen familia.
 */
async function findFamilyVariants(sku: string, productId: string): Promise<FamilyVariantContext[]> {
  const family = sku.split(' ')[0]
  if (!family || family === sku.trim()) return []
  const rows = await prisma.product.findMany({
    where: { sku: { startsWith: family + ' ' }, id: { not: productId } },
    select: {
      sku: true,
      name: true,
      stockQuantity: true,
      unit: true,
      mlItemLinks: {
        where: { mlStatus: 'active' },
        select: { title: true },
        take: 1,
      },
    },
    orderBy: { sku: 'asc' },
    take: 40,
  })
  return rows.map((r) => ({
    sku: r.sku,
    name: r.name,
    stockQuantity: r.stockQuantity,
    unit: r.unit,
    mlTitle: r.mlItemLinks[0]?.title ?? null,
  }))
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
  const product = await findErpProduct(row.mlItemId, sku)
  const productCtx: ErpProductContext | null = product
    ? {
        sku: product.sku,
        name: product.name,
        brand: product.brand,
        description: product.description,
        stockQuantity: product.stockQuantity,
        unit: product.unit,
        // Fuente principal de datos técnicos. Si la ficha todavía no tiene el
        // texto extraído (cargada antes de este cambio), se extrae acá y queda
        // guardada para las próximas preguntas.
        technicalSheetText: await ensureTechnicalSheetText(product),
        family: await findFamilyVariants(product.sku, product.id),
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
 * Cierra en el ERP una pregunta que dejó de estar pendiente en ML: respondida
 * directo desde la página de ML, borrada por el comprador, baneada o con el
 * ítem cerrado. Sin esto, lo que se contesta por fuera del ERP queda en
 * Pendientes para siempre. Devuelve true si actualizó la fila local.
 */
export async function reconcileExternalQuestion(question: MlQuestion): Promise<boolean> {
  // UNDER_REVIEW es moderación de ML y puede volver a UNANSWERED: no tocar.
  if (question.status === 'UNANSWERED' || question.status === 'UNDER_REVIEW') return false
  const row = await prisma.mlQuestion.findUnique({ where: { mlQuestionId: BigInt(question.id) } })
  if (!row) return false
  if (row.status !== MlQuestionStatus.PENDING_REVIEW && row.status !== MlQuestionStatus.FAILED)
    return false

  if (question.status === 'ANSWERED') {
    await prisma.mlQuestion.update({
      where: { id: row.id },
      data: {
        status: MlQuestionStatus.ANSWERED,
        answerText: question.answer?.text ?? row.answerText,
        answeredAt: question.answer?.date_created ? new Date(question.answer.date_created) : new Date(),
        answeredById: null, // respondida en la página de ML, no desde el ERP
        errorDetail: null,
      },
    })
  } else {
    await prisma.mlQuestion.update({
      where: { id: row.id },
      data: { status: MlQuestionStatus.CLOSED, errorDetail: null },
    })
  }
  logger.info(
    `[ML Preguntas] question=${question.id} ${question.status} en ML, fila local actualizada`
  )
  return true
}

/**
 * Ingresa una pregunta de ML al ERP: crea el registro (idempotente), genera el
 * borrador y, en modo AUTO sin revisión, la publica. Devuelve el registro o
 * null si se salteó.
 */
export async function ingestQuestion(question: MlQuestion): Promise<MlQuestionRow | null> {
  if (question.status !== 'UNANSWERED') {
    // Puede ser una notificación de que la respondieron/cerraron desde ML.
    await reconcileExternalQuestion(question)
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
 * Además reconcilia las pendientes del ERP que ya no figuran sin responder en
 * ML (respondidas desde la página de ML, borradas, etc.). Devuelve cuántas se
 * crearon y cuántas se cerraron.
 */
export async function syncUnansweredQuestions(): Promise<{
  found: number
  created: number
  closed: number
}> {
  let offset = 0
  const limit = 50
  let found = 0
  let created = 0
  const unanswered = new Set<string>()
  for (;;) {
    const page = await getMyUnansweredQuestions(limit, offset)
    const qs = page.questions ?? []
    found += qs.length
    for (const q of qs) {
      unanswered.add(String(q.id))
      const row = await ingestQuestion(q)
      if (row) created++
    }
    if (qs.length < limit) break
    offset += limit
    if (offset > 1000) break // guardia
  }

  // Pendientes locales que ML ya no lista como sin responder: consultar una
  // por una y cerrarlas según su estado real.
  let closed = 0
  const pending = await prisma.mlQuestion.findMany({
    where: { status: { in: [MlQuestionStatus.PENDING_REVIEW, MlQuestionStatus.FAILED] } },
    select: { mlQuestionId: true },
  })
  for (const p of pending) {
    if (unanswered.has(p.mlQuestionId.toString())) continue
    try {
      const q = await getQuestion(p.mlQuestionId.toString())
      if (await reconcileExternalQuestion(q)) closed++
    } catch (err) {
      if (err instanceof MlApiError && err.status === 404) {
        await prisma.mlQuestion.update({
          where: { mlQuestionId: p.mlQuestionId },
          data: { status: MlQuestionStatus.CLOSED },
        })
        closed++
      } else {
        logger.error(`[ML Preguntas] Error reconciliando question=${p.mlQuestionId}`, err)
      }
    }
  }

  logger.info(`[ML Preguntas] Sync: ${found} sin responder, ${created} nuevas, ${closed} cerradas`)
  return { found, created, closed }
}

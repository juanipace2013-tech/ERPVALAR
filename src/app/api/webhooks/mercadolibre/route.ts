/**
 * Webhook receptor de notificaciones de Mercado Libre.
 *
 * POST /api/webhooks/mercadolibre
 *   Body típico:
 *   { resource, user_id, topic, application_id, attempts, sent }
 *
 *   ML exige respuesta HTTP 200 en < 500ms o reintenta. Por eso:
 *   validamos mínimamente, persistimos el raw en MlNotification, devolvemos 200
 *   y disparamos el procesamiento fire-and-forget (mismo patrón que el webhook
 *   de Microsoft Graph). NO procesamos sincrónico antes del 200.
 *
 *   Procesamos topics "orders"/"orders_v2" (post-venta), "questions" (preguntas)
 *   y "messages" (respuestas del comprador -> auto-reply con el texto completo
 *   cuando el envío original quedó en fallback template REQUEST_VARIANTS).
 *   OJO: el topic "messages" hay que suscribirlo en la config de la app en el
 *   DevCenter de ML, si no ML no lo manda.
 *
 * Variables de entorno:
 *   ML_FORWARD_WEBHOOK_URL — opcional. Si está seteada, reenviamos TODA
 *                       notificación (payload crudo) a esa URL, fire-and-forget.
 *                       Sirve para mantener vivo el bot anterior (Railway) ya
 *                       que ML admite una sola URL de callback por app.
 *   ML_WEBHOOK_SECRET — opcional. Si está seteada, exigimos que venga como
 *                       ?secret=... en la URL del callback registrada en ML.
 *
 * Docs: https://developers.mercadolibre.com.ar/es_ar/notificaciones
 */

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { handlePostSale } from '@/lib/mercadolibre/handlePostSale'
import { handleQuestionNotification } from '@/lib/mercadolibre/handleQuestion'
import { handleBuyerReply } from '@/lib/mercadolibre/handleBuyerReply'

interface MlNotificationPayload {
  resource?: string
  user_id?: number
  topic?: string
  application_id?: number
  attempts?: number
  sent?: string
  received?: string
}

const ORDER_TOPICS = new Set(['orders', 'orders_v2'])
const QUESTION_TOPICS = new Set(['questions'])
const MESSAGE_TOPICS = new Set(['messages'])

export async function POST(req: NextRequest) {
  // Validación opcional de secreto compartido por query string.
  const expectedSecret = process.env.ML_WEBHOOK_SECRET
  if (expectedSecret) {
    const secret = new URL(req.url).searchParams.get('secret')
    if (secret !== expectedSecret) {
      logger.warn('[ML Webhook] secret inválido')
      // 200 igual para no filtrar info ni provocar reintentos infinitos.
      return NextResponse.json({ ok: true })
    }
  }

  let payload: MlNotificationPayload
  try {
    payload = await req.json()
  } catch (e) {
    logger.error('[ML Webhook] JSON inválido', e)
    return NextResponse.json({ ok: true })
  }

  const topic = payload.topic ?? ''
  const resource = payload.resource ?? ''

  // Reenvío opcional al bot anterior (todas las notificaciones, tal cual llegan).
  const forwardUrl = process.env.ML_FORWARD_WEBHOOK_URL
  if (forwardUrl) {
    fetch(forwardUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    }).catch((e) => logger.warn(`[ML Webhook] Forward a ${forwardUrl} falló: ${String(e)}`))
  }

  const isOrder = ORDER_TOPICS.has(topic)
  const isQuestion = QUESTION_TOPICS.has(topic)
  const isMessage = MESSAGE_TOPICS.has(topic)
  // Solo órdenes, preguntas y mensajes. El resto lo descartamos con 200.
  if ((!isOrder && !isQuestion && !isMessage) || !resource) {
    return NextResponse.json({ ok: true })
  }

  // Persistir el raw y disparar el procesamiento fire-and-forget.
  ;(async () => {
    try {
      const notif = await prisma.mlNotification.create({
        data: {
          topic,
          resource,
          mlUserId: payload.user_id != null ? BigInt(payload.user_id) : null,
        },
      })

      // Fire-and-forget: el handler trae la orden, matchea regla y procesa.
      // Si falla, queda logueado; ML reintenta la notificación y la
      // idempotencia por packId evita duplicados.
      if (isQuestion) await handleQuestionNotification(notif.id)
      else if (isMessage) await handleBuyerReply(notif.id)
      else await handlePostSale(notif.id)
    } catch (e) {
      logger.error('[ML Webhook] Error procesando notificación', e)
    }
  })().catch((e) => logger.error('[ML Webhook] Error de fondo', e))

  return NextResponse.json({ ok: true })
}

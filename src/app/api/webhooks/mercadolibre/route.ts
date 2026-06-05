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
 *   Solo procesamos topics "orders" y "orders_v2".
 *
 * Variables de entorno:
 *   ML_WEBHOOK_SECRET — opcional. Si está seteada, exigimos que venga como
 *                       ?secret=... en la URL del callback registrada en ML.
 *
 * Docs: https://developers.mercadolibre.com.ar/es_ar/notificaciones
 */

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { handlePostSale } from '@/lib/mercadolibre/handlePostSale'

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

  // Solo nos interesan las órdenes. El resto lo descartamos con 200.
  if (!ORDER_TOPICS.has(topic) || !resource) {
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
      await handlePostSale(notif.id)
    } catch (e) {
      logger.error('[ML Webhook] Error procesando notificación', e)
    }
  })().catch((e) => logger.error('[ML Webhook] Error de fondo', e))

  return NextResponse.json({ ok: true })
}

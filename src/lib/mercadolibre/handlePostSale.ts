/**
 * Handler de mensajería post-venta de Mercado Libre.
 *
 * Procesa una notificación de orden (topic "orders"/"orders_v2"):
 *   1. Extrae el orderId del resource y trae la orden.
 *   2. Gatea: solo órdenes pagas (status === "paid").
 *   3. Calcula packId = pack_id ?? order.id.
 *   4. Idempotencia por packId (UNIQUE en MlPostSaleMessage).
 *   5. Matchea una MlMessageRule enabled por ml_item_id o seller_sku.
 *   6. Chequea cap_available para la opción OTHER del action_guide.
 *   7. Según el modo de la regla: REVIEW (deja pendiente) o AUTO (envía).
 *   8. Marca la notificación como processed.
 *
 * El envío real (paso 7-AUTO) está en sendPostSaleMessage, reutilizado por el
 * endpoint de envío manual del modo REVIEW.
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { MlPostSaleStatus, type MlPostSaleMessage } from '@prisma/client'
import {
  getOrder,
  getActionGuideCaps,
  postActionGuideOption,
  MlApiError,
  type MlOrder,
  type MlPostOptionResponse,
} from './client'

const OTHER_OPTION_ID = 'OTHER'

/** Extrae el id de orden de un resource tipo "/orders/123" -> "123". */
export function parseOrderId(resource: string): string | null {
  const m = resource.match(/\/orders\/(\d+)/)
  return m ? m[1] : null
}

/** packId de la orden: pack_id si existe, si no el propio id. Siempre string. */
function resolvePackId(order: MlOrder): string {
  return String(order.pack_id ?? order.id)
}

/** Matchea la primera regla enabled cuyo ml_item_id o seller_sku aparezca en la orden. */
async function findMatchingRule(order: MlOrder) {
  const rules = await prisma.mlMessageRule.findMany({ where: { enabled: true } })
  if (rules.length === 0) return null

  for (const oi of order.order_items) {
    const itemId = oi.item?.id
    const sku = oi.item?.seller_sku ?? oi.item?.seller_custom_field ?? null

    const match = rules.find(
      (r) =>
        (r.mlItemId && itemId && r.mlItemId === itemId) ||
        (r.sellerSku && sku && r.sellerSku === sku)
    )
    if (match) return match
  }
  return null
}

/** Detecta si ML moderó/rechazó el mensaje a partir de la respuesta del POST. */
function detectModeration(resp: MlPostOptionResponse): {
  moderated: boolean
  reason: string | null
} {
  const mod = resp.moderation
  if (!mod) return { moderated: false, reason: null }
  const status = (mod.status ?? '').toLowerCase()
  // "clean"/"approved"/"" => ok. Cualquier otra cosa (rejected, pending,
  // blocked...) la tratamos como moderada para no insistir.
  const moderated = status !== '' && status !== 'clean' && status !== 'approved'
  const reason = mod.reason ?? mod.moderation_reason ?? (moderated ? status : null)
  return { moderated, reason: reason || null }
}

/**
 * Envía el mensaje OTHER del action_guide para un MlPostSaleMessage y actualiza
 * su status. Reutilizado por el modo AUTO y por el endpoint de envío manual.
 * Devuelve el registro actualizado.
 */
export async function sendPostSaleMessage(
  message: MlPostSaleMessage
): Promise<MlPostSaleMessage> {
  try {
    const resp = await postActionGuideOption(message.packId, OTHER_OPTION_ID, message.text)
    const { moderated, reason } = detectModeration(resp)

    if (moderated) {
      logger.warn(
        `[ML PostSale] Mensaje moderado pack=${message.packId} reason=${reason ?? 'desconocido'}`
      )
      return prisma.mlPostSaleMessage.update({
        where: { id: message.id },
        data: {
          status: MlPostSaleStatus.MODERATED,
          moderationReason: reason,
          mlMessageId: resp.id ?? resp.message_id ?? null,
        },
      })
    }

    logger.info(`[ML PostSale] Mensaje enviado OK pack=${message.packId}`)
    return prisma.mlPostSaleMessage.update({
      where: { id: message.id },
      data: {
        status: MlPostSaleStatus.SENT,
        mlMessageId: resp.id ?? resp.message_id ?? null,
        sentAt: new Date(),
      },
    })
  } catch (err) {
    const detail = err instanceof MlApiError ? JSON.stringify(err.body) : String(err)
    logger.error(`[ML PostSale] Error enviando pack=${message.packId}`, detail)
    return prisma.mlPostSaleMessage.update({
      where: { id: message.id },
      data: {
        status: MlPostSaleStatus.FAILED,
        moderationReason: `API error: ${detail}`.slice(0, 500),
      },
    })
  }
}

/**
 * Procesa una notificación de orden. Idempotente. Marca la notificación como
 * processed salvo que falle antes de poder hacerlo (se reintenta en la próxima
 * notificación de ML).
 */
export async function handlePostSale(notificationId: string): Promise<void> {
  const notif = await prisma.mlNotification.findUnique({ where: { id: notificationId } })
  if (!notif) {
    logger.warn(`[ML PostSale] Notificación ${notificationId} no encontrada`)
    return
  }
  if (notif.processed) return

  const markProcessed = () =>
    prisma.mlNotification.update({
      where: { id: notif.id },
      data: { processed: true, attempts: { increment: 1 } },
    })

  // 1. orderId + orden
  const orderId = parseOrderId(notif.resource)
  if (!orderId) {
    logger.warn(`[ML PostSale] Resource sin orderId: ${notif.resource}`)
    await markProcessed()
    return
  }

  const order = await getOrder(orderId)

  // 2. Gating: solo órdenes pagas
  if (order.status !== 'paid') {
    logger.info(`[ML PostSale] Orden ${orderId} status=${order.status} (no paga), skip`)
    await markProcessed()
    return
  }

  // 3. packId
  const packId = resolvePackId(order)

  // 4. Idempotencia
  const existing = await prisma.mlPostSaleMessage.findUnique({ where: { packId } })
  if (existing) {
    logger.info(`[ML PostSale] pack=${packId} ya procesado (status=${existing.status}), skip`)
    await markProcessed()
    return
  }

  // 5. Match de regla
  const rule = await findMatchingRule(order)
  if (!rule) {
    logger.info(`[ML PostSale] Orden ${orderId} sin regla que matchee, skip`)
    await markProcessed()
    return
  }

  // 6. cap_available para OTHER
  let capOk = false
  try {
    const list = await getActionGuideCaps(packId)
    const other = list.find(
      (c) => (c.option_id ?? c.id)?.toUpperCase() === OTHER_OPTION_ID
    )
    capOk = (other?.cap_available ?? 0) >= 1
  } catch (err) {
    const detail = err instanceof MlApiError ? JSON.stringify(err.body) : String(err)
    logger.error(`[ML PostSale] Error leyendo caps pack=${packId}`, detail)
    // No pudimos confirmar cap: dejamos la notificación SIN procesar para que
    // un próximo intento lo resuelva. No creamos registro.
    return
  }

  if (!capOk) {
    logger.info(`[ML PostSale] Sin cap_available para OTHER pack=${packId}, SKIPPED`)
    try {
      await prisma.mlPostSaleMessage.create({
        data: {
          packId,
          orderId,
          ruleId: rule.id,
          status: MlPostSaleStatus.SKIPPED,
          text: rule.messageText,
        },
      })
    } catch {
      // Carrera entre notificaciones duplicadas de la misma orden: el UNIQUE
      // de packId ya la selló, es idempotencia y no un error real.
      logger.info(`[ML PostSale] pack=${packId} creado en paralelo (SKIPPED), skip`)
    }
    await markProcessed()
    return
  }

  // 7. Crear el registro y, según modo, enviar o dejar pendiente.
  // Se crea siempre con PENDING_REVIEW (default) para que el UNIQUE de packId
  // selle la idempotencia antes de cualquier envío.
  let message: MlPostSaleMessage
  try {
    message = await prisma.mlPostSaleMessage.create({
      data: {
        packId,
        orderId,
        ruleId: rule.id,
        status: MlPostSaleStatus.PENDING_REVIEW,
        text: rule.messageText,
      },
    })
  } catch (err) {
    // Posible carrera: otra notificación creó el mismo packId entre el check y
    // el create. Es idempotencia, no un error real.
    logger.info(`[ML PostSale] pack=${packId} creado en paralelo, skip`)
    await markProcessed()
    return
  }

  if (rule.mode === 'AUTO') {
    await sendPostSaleMessage(message)
  } else {
    logger.info(`[ML PostSale] pack=${packId} en PENDING_REVIEW (modo REVIEW)`)
  }

  // 8. processed
  await markProcessed()
}

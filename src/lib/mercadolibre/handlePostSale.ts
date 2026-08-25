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
  getPackMessages,
  postActionGuideOption,
  MlApiError,
  REQUEST_VARIANTS_TEMPLATE_ID,
  type MlOrder,
  type MlPostOptionResponse,
} from './client'

const OTHER_OPTION_ID = 'OTHER'
// Cuánto esperar después de un envío OK para re-chequear la moderación
// asíncrona de ML (el POST devuelve limpio y el rechazo aparece después).
const MODERATION_RECHECK_DELAY_MS = 3 * 60 * 1000
// Ventana del barrido del cron: mensajes SENT de las últimas 48 h.
const MODERATION_SWEEP_WINDOW_MS = 48 * 60 * 60 * 1000

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

/** "MARIANO" / "mariano gabriel" -> "Mariano" (solo el primer nombre). */
function formatFirstName(raw?: string | null): string | null {
  const name = (raw ?? '').trim().split(/\s+/)[0]
  if (!name) return null
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
}

/**
 * Renderiza el template de la regla para una orden concreta. Soporta
 * {{nombre}} (primer nombre del comprador) y {{venta}} (packId). Personalizar
 * el texto por venta evita el filtro "automatic_message" de ML, que rechaza
 * mensajes idénticos repetidos entre compradores.
 */
export function renderMessageTemplate(
  template: string,
  order: MlOrder,
  packId: string
): string {
  const nombre = formatFirstName(order.buyer?.first_name)
  let text = template.replace(/\{\{\s*venta\s*\}\}/g, packId)
  if (nombre) {
    text = text.replace(/\{\{\s*nombre\s*\}\}/g, nombre)
  } else {
    // Sin nombre: sacamos el placeholder y el espacio que lo precede
    // ("Buen dia {{nombre}}." -> "Buen dia.").
    text = text.replace(/ ?\{\{\s*nombre\s*\}\}/g, '')
  }
  return text
}

/** Estado de moderación que consideramos rechazo (todo lo que no sea limpio). */
export function isRejectedModerationStatus(status: string | undefined): boolean {
  const s = (status ?? '').toLowerCase()
  return s !== '' && s !== 'clean' && s !== 'approved'
}

/** Detecta si ML moderó/rechazó el mensaje a partir de la respuesta del POST. */
export function detectModeration(resp: MlPostOptionResponse): {
  moderated: boolean
  reason: string | null
} {
  // La API devuelve la moderación en message_moderation (el status del mensaje
  // queda "moderated"); resp.moderation era una suposición errónea que dejaba
  // pasar rechazos como enviados.
  const mod = resp.message_moderation ?? resp.moderation
  if (!mod) return { moderated: resp.status === 'moderated', reason: null }
  // "clean"/"approved"/"" => ok. Cualquier otra cosa (rejected, pending,
  // blocked...) la tratamos como moderada para no insistir.
  const moderated = isRejectedModerationStatus(mod.status) || resp.status === 'moderated'
  const reason =
    mod.reason ??
    ('moderation_reason' in mod ? mod.moderation_reason : null) ??
    (moderated ? mod.status ?? null : null)
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
      // Fallback: el template REQUEST_VARIANTS no pasa por moderación, así el
      // comprador al menos recibe el pedido de confirmar características y al
      // responder se abre la conversación para mandarle el detalle de rangos.
      try {
        const tplResp = await postActionGuideOption(
          message.packId,
          'REQUEST_VARIANTS',
          undefined,
          REQUEST_VARIANTS_TEMPLATE_ID
        )
        const tplMod = detectModeration(tplResp)
        if (!tplMod.moderated) {
          logger.info(
            `[ML PostSale] Fallback template REQUEST_VARIANTS enviado pack=${message.packId}`
          )
          return prisma.mlPostSaleMessage.update({
            where: { id: message.id },
            data: {
              status: MlPostSaleStatus.SENT,
              sentAt: new Date(),
              mlMessageId: tplResp.id ?? tplResp.message_id ?? null,
              moderationReason: `OTHER rechazado (${reason ?? 'desconocido'}); enviado template REQUEST_VARIANTS`,
            },
          })
        }
      } catch (tplErr) {
        const tplDetail =
          tplErr instanceof MlApiError ? JSON.stringify(tplErr.body) : String(tplErr)
        logger.error(
          `[ML PostSale] Fallback template falló pack=${message.packId}`,
          tplDetail
        )
      }
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
    const sent = await prisma.mlPostSaleMessage.update({
      where: { id: message.id },
      data: {
        status: MlPostSaleStatus.SENT,
        mlMessageId: resp.id ?? resp.message_id ?? null,
        sentAt: new Date(),
      },
    })

    // La moderación de ML es asíncrona: re-chequear en unos minutos. El cron
    // de barrido cubre el caso de que el proceso se reinicie antes.
    const timer = setTimeout(() => {
      verifySentModeration(sent.id).catch((e) =>
        logger.error(`[ML PostSale] Re-chequeo de moderación falló pack=${sent.packId}`, e)
      )
    }, MODERATION_RECHECK_DELAY_MS)
    timer.unref?.()

    return sent
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
 * Re-chequea contra la API si un mensaje SENT fue rechazado por la moderación
 * asíncrona de ML; si lo fue, lo pasa a MODERATED. Silencioso si el mensaje
 * ya no está SENT o todavía no aparece en el thread.
 */
export async function verifySentModeration(messageId: string): Promise<void> {
  const message = await prisma.mlPostSaleMessage.findUnique({ where: { id: messageId } })
  if (!message || message.status !== MlPostSaleStatus.SENT) return

  const thread = await getPackMessages(message.packId)
  // Preferimos matchear por id de mensaje; si no lo guardamos, por texto.
  const own = thread.find((m) =>
    message.mlMessageId ? m.id === message.mlMessageId : m.text === message.text
  )
  if (!own) return

  const mod = own.message_moderation
  if (!isRejectedModerationStatus(mod?.status)) return

  const reason = mod?.reason ?? mod?.status ?? 'moderated'
  logger.warn(
    `[ML PostSale] Moderación asíncrona: pack=${message.packId} rechazado (${reason})`
  )
  await prisma.mlPostSaleMessage.update({
    where: { id: message.id },
    data: { status: MlPostSaleStatus.MODERATED, moderationReason: String(reason).slice(0, 500) },
  })
}

/**
 * Barrido para el cron: re-chequea la moderación de todos los mensajes SENT
 * de las últimas 48 h. Devuelve cuántos revisó y cuántos pasaron a MODERATED.
 */
export async function sweepSentModeration(): Promise<{ checked: number; moderated: number }> {
  const since = new Date(Date.now() - MODERATION_SWEEP_WINDOW_MS)
  const sent = await prisma.mlPostSaleMessage.findMany({
    where: { status: MlPostSaleStatus.SENT, sentAt: { gte: since } },
  })

  let moderated = 0
  for (const m of sent) {
    try {
      await verifySentModeration(m.id)
      const after = await prisma.mlPostSaleMessage.findUnique({ where: { id: m.id } })
      if (after?.status === MlPostSaleStatus.MODERATED) moderated++
    } catch (e) {
      logger.error(`[ML PostSale] Sweep de moderación falló pack=${m.packId}`, e)
    }
  }
  return { checked: sent.length, moderated }
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

  // Texto final personalizado para esta venta (ver renderMessageTemplate).
  const messageText = renderMessageTemplate(rule.messageText, order, packId)

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
          text: messageText,
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
        text: messageText,
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

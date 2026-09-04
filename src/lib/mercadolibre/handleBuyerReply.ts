/**
 * Auto-reply post-venta: el primer mensaje de la venta es SIEMPRE el template
 * REQUEST_VARIANTS ("confirmá las características...", desde 4/9/26 es el
 * envío primario — antes era fallback tras el rechazo de OTHER por
 * "automatic_message"). Cuando el comprador responde, la conversación queda
 * abierta y ahí sí se puede mandar texto por POST /messages/packs. Este handler
 * procesa las notificaciones del topic "messages" y le envía al comprador el
 * texto completo (los rangos de manómetro) que quedó guardado en el registro.
 *
 * Flujo por notificación:
 *   1. Extrae el messageId del resource ("/messages/{id}") y trae el mensaje.
 *   2. Descarta mensajes propios (from == seller) — cada envío nuestro también
 *      genera notificación.
 *   3. Resuelve el packId desde message_resources ({name: "packs"}).
 *   4. Busca el MlPostSaleMessage del pack: solo aplica si está SENT vía
 *      fallback template (moderationReason contiene FALLBACK_MARKER).
 *   5. Claim atómico de autoReplyStatus (null -> SENDING): un solo reply por
 *      pack aunque lleguen notificaciones duplicadas o mensajes sucesivos.
 *   6. Envía el texto y registra el resultado (SENT / MODERATED / FAILED).
 *
 * Diseño VALIDADO con venta real (pack 2000014703785113, 2026-08-25): el texto
 * libre en conversación abierta pasa limpio (HTTP 201, moderation "clean") —
 * el filtro automatic_message solo aplica al action_guide, no acá. Igual se
 * detecta moderación sincrónica en el POST, se re-chequea a los 3 minutos y el
 * cron barre los auto-replies SENT de las últimas 48 h, por si ML cambia.
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { MlAutoReplyStatus, MlPostSaleStatus } from '@prisma/client'
import {
  getMessage,
  getPackMessages,
  getMlUserId,
  sendPackMessage,
  MlApiError,
} from './client'
import { detectModeration, isRejectedModerationStatus } from './handlePostSale'

// Substring que sendPostSaleMessage graba en moderationReason cuando el envío
// salió via template REQUEST_VARIANTS (hoy el camino primario). Marca los
// packs elegibles para auto-reply con el texto completo.
const FALLBACK_MARKER = 'enviado template REQUEST_VARIANTS'
// Igual que el envío original: la moderación de ML es asíncrona, re-chequear.
const MODERATION_RECHECK_DELAY_MS = 3 * 60 * 1000
// Ventana del barrido del cron para auto-replies SENT.
const MODERATION_SWEEP_WINDOW_MS = 48 * 60 * 60 * 1000

/**
 * Extrae el id de mensaje del resource. ML usa dos formatos para el topic
 * "messages": "/messages/abc123" y el id pelado "abc123" (visto en prod el
 * 4/9/26 — venta 2000014867157377: el resource pelado devolvía null y la
 * respuesta del comprador se descartaba sin auto-reply).
 */
export function parseMessageId(resource: string): string | null {
  const m = resource.match(/\/messages\/([A-Za-z0-9-]+)/)
  if (m) return m[1]
  const bare = resource.trim()
  return /^[A-Za-z0-9-]+$/.test(bare) ? bare : null
}

/**
 * Procesa una notificación del topic "messages". Idempotente por el claim
 * atómico de autoReplyStatus. Marca la notificación como processed salvo error
 * antes de poder decidir (ML reintenta la notificación).
 */
export async function handleBuyerReply(notificationId: string): Promise<void> {
  const notif = await prisma.mlNotification.findUnique({ where: { id: notificationId } })
  if (!notif) {
    logger.warn(`[ML AutoReply] Notificación ${notificationId} no encontrada`)
    return
  }
  if (notif.processed) return

  const markProcessed = () =>
    prisma.mlNotification.update({
      where: { id: notif.id },
      data: { processed: true, attempts: { increment: 1 } },
    })

  const messageId = parseMessageId(notif.resource)
  if (!messageId) {
    logger.warn(`[ML AutoReply] Resource sin messageId: ${notif.resource}`)
    await markProcessed()
    return
  }

  const [message, sellerId] = await Promise.all([getMessage(messageId), getMlUserId()])
  if (!message) {
    logger.warn(`[ML AutoReply] Mensaje ${messageId} no encontrado en la API`)
    await markProcessed()
    return
  }

  // Mensaje propio (incluye el auto-reply mismo): no es respuesta del comprador.
  if (String(message.from?.user_id ?? '') === sellerId) {
    await markProcessed()
    return
  }

  const packId = message.message_resources?.find((r) => r.name === 'packs')?.id
  if (!packId) {
    logger.warn(`[ML AutoReply] Mensaje ${messageId} sin pack en message_resources`)
    await markProcessed()
    return
  }

  const record = await prisma.mlPostSaleMessage.findUnique({
    where: { packId: String(packId) },
  })

  // Solo packs cuyo envío quedó en fallback template y todavía sin auto-reply.
  const eligible =
    record &&
    record.status === MlPostSaleStatus.SENT &&
    (record.moderationReason ?? '').includes(FALLBACK_MARKER) &&
    record.autoReplyStatus === null

  if (!record || !eligible) {
    await markProcessed()
    return
  }

  // Claim atómico: null -> SENDING. Si otra notificación (duplicada o de un
  // segundo mensaje del comprador) llegó primero, count = 0 y no hacemos nada.
  const claimed = await prisma.mlPostSaleMessage.updateMany({
    where: { id: record.id, autoReplyStatus: null },
    data: { autoReplyStatus: MlAutoReplyStatus.SENDING, autoReplyAt: new Date() },
  })
  if (claimed.count === 0) {
    logger.info(`[ML AutoReply] pack=${record.packId} ya reclamado en paralelo, skip`)
    await markProcessed()
    return
  }

  const buyerUserId = message.from?.user_id
  if (buyerUserId == null) {
    logger.warn(`[ML AutoReply] Mensaje ${messageId} sin from.user_id, no puedo responder`)
    await prisma.mlPostSaleMessage.update({
      where: { id: record.id },
      data: {
        autoReplyStatus: MlAutoReplyStatus.FAILED,
        autoReplyError: 'Mensaje del comprador sin from.user_id',
      },
    })
    await markProcessed()
    return
  }

  try {
    const resp = await sendPackMessage(record.packId, buyerUserId, record.text)
    const { moderated, reason } = detectModeration(resp)

    if (moderated) {
      // Señal clave para validar el diseño: si esto aparece, el texto libre en
      // conversación abierta TAMBIÉN se modera y hay que replantear.
      logger.warn(
        `[ML AutoReply] Auto-reply MODERADO pack=${record.packId} reason=${reason ?? 'desconocido'}`
      )
      await prisma.mlPostSaleMessage.update({
        where: { id: record.id },
        data: {
          autoReplyStatus: MlAutoReplyStatus.MODERATED,
          autoReplyMlMessageId: resp.id ?? resp.message_id ?? null,
          autoReplyError: reason,
        },
      })
      await markProcessed()
      return
    }

    logger.info(`[ML AutoReply] Texto completo enviado OK pack=${record.packId}`)
    await prisma.mlPostSaleMessage.update({
      where: { id: record.id },
      data: {
        autoReplyStatus: MlAutoReplyStatus.SENT,
        autoReplyAt: new Date(),
        autoReplyMlMessageId: resp.id ?? resp.message_id ?? null,
      },
    })

    // Moderación asíncrona: re-chequear en unos minutos. El cron de barrido
    // cubre el caso de que el proceso se reinicie antes.
    const timer = setTimeout(() => {
      verifyAutoReplyModeration(record.id).catch((e) =>
        logger.error(
          `[ML AutoReply] Re-chequeo de moderación falló pack=${record.packId}`,
          e
        )
      )
    }, MODERATION_RECHECK_DELAY_MS)
    timer.unref?.()
  } catch (err) {
    const detail = err instanceof MlApiError ? JSON.stringify(err.body) : String(err)
    logger.error(`[ML AutoReply] Error enviando pack=${record.packId}`, detail)
    // FAILED es terminal a propósito: garantiza un solo intento por pack (no
    // sabemos si el mensaje salió pese al error). Se puede resetear a mano.
    await prisma.mlPostSaleMessage.update({
      where: { id: record.id },
      data: {
        autoReplyStatus: MlAutoReplyStatus.FAILED,
        autoReplyError: `API error: ${detail}`.slice(0, 500),
      },
    })
  }

  await markProcessed()
}

/**
 * Re-chequea contra el thread si un auto-reply SENT fue rechazado por la
 * moderación asíncrona de ML; si lo fue, lo pasa a MODERATED. El match es por
 * autoReplyMlMessageId; si no lo tenemos, por texto + fecha posterior al envío
 * (el texto solo no alcanza: el intento OTHER original, moderado, tiene el
 * mismo texto y puede aparecer en el thread).
 */
export async function verifyAutoReplyModeration(recordId: string): Promise<void> {
  const record = await prisma.mlPostSaleMessage.findUnique({ where: { id: recordId } })
  if (!record || record.autoReplyStatus !== MlAutoReplyStatus.SENT) return

  const thread = await getPackMessages(record.packId)
  const sentAtMs = record.autoReplyAt?.getTime() ?? 0
  const own = thread.find((m) => {
    if (record.autoReplyMlMessageId) return m.id === record.autoReplyMlMessageId
    if (m.text !== record.text) return false
    const createdMs = m.message_date?.created ? Date.parse(m.message_date.created) : NaN
    // 5 min de margen por desfasaje de relojes entre nuestro claim y ML.
    return !Number.isNaN(createdMs) && createdMs >= sentAtMs - 5 * 60 * 1000
  })
  if (!own) return

  const mod = own.message_moderation
  if (!isRejectedModerationStatus(mod?.status)) return

  const reason = mod?.reason ?? mod?.status ?? 'moderated'
  logger.warn(
    `[ML AutoReply] Moderación asíncrona: pack=${record.packId} auto-reply rechazado (${reason})`
  )
  await prisma.mlPostSaleMessage.update({
    where: { id: record.id },
    data: {
      autoReplyStatus: MlAutoReplyStatus.MODERATED,
      autoReplyError: String(reason).slice(0, 500),
    },
  })
}

/**
 * Barrido para el cron: re-chequea la moderación de los auto-replies SENT de
 * las últimas 48 h. Devuelve cuántos revisó y cuántos pasaron a MODERATED.
 */
export async function sweepAutoReplyModeration(): Promise<{
  checked: number
  moderated: number
}> {
  const since = new Date(Date.now() - MODERATION_SWEEP_WINDOW_MS)
  const sent = await prisma.mlPostSaleMessage.findMany({
    where: { autoReplyStatus: MlAutoReplyStatus.SENT, autoReplyAt: { gte: since } },
  })

  let moderated = 0
  for (const m of sent) {
    try {
      await verifyAutoReplyModeration(m.id)
      const after = await prisma.mlPostSaleMessage.findUnique({ where: { id: m.id } })
      if (after?.autoReplyStatus === MlAutoReplyStatus.MODERATED) moderated++
    } catch (e) {
      logger.error(`[ML AutoReply] Sweep de moderación falló pack=${m.packId}`, e)
    }
  }
  return { checked: sent.length, moderated }
}

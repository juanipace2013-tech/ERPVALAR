/**
 * Red de seguridad del auto-reply post-venta: detecta respuestas de compradores
 * que NO dispararon el auto-reply (webhook caído, notificación perdida, cambio
 * de formato del resource como el del 4/9/26 — 10 días de replies descartados
 * sin que nadie se entere) y estados de error, y avisa por mail.
 *
 * Corre desde el cron check-ml-moderation (cada 30 min):
 *   1. Packs elegibles (SENT via template, autoReplyStatus null, sin alertar):
 *      lee el hilo directo de la API de ML — NO depende del webhook ni del
 *      parseo de notificaciones. Si el comprador escribió después de nuestro
 *      template:
 *        - respuesta de las últimas 48 h -> AUTO-REPARA (claim + envío del
 *          texto completo, mismo camino que el webhook) y avisa.
 *        - más vieja -> solo avisa (mandar rangos días después confunde).
 *   2. Packs en estado de error (MODERATED/FAILED en el envío o el auto-reply,
 *      o SENDING colgado > 1 h): avisa.
 *
 * Cada pack se alerta UNA vez (alertedAt); el mail va a ML_ALERT_EMAIL
 * (default ventas@val-ar.com.ar).
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { MlAutoReplyStatus, MlPostSaleStatus } from '@prisma/client'
import { getPackMessages, getMlUserId } from './client'
import { claimAndSendAutoReply, FALLBACK_MARKER } from './handleBuyerReply'
import { sendMail } from '@/lib/email/microsoft-graph'

const SCAN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
// Margen para que el camino normal (webhook) llegue primero.
const REPLY_GRACE_MS = 10 * 60 * 1000
// Respuestas más viejas que esto no se auto-reparan (rangos fuera de contexto).
const REPAIR_WINDOW_MS = 48 * 60 * 60 * 1000
const STUCK_SENDING_MS = 60 * 60 * 1000

const fmtAr = (d: Date | number) =>
  new Date(d).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })

export async function sweepMissedAutoReplies(): Promise<{
  checked: number
  repaired: number
  alerted: number
}> {
  const sellerId = await getMlUserId()
  const since = new Date(Date.now() - SCAN_WINDOW_MS)

  const alerts: string[] = []
  const alertIds = new Set<string>()
  let repaired = 0

  // 1. Respuestas del comprador sin auto-reply (contra el hilo real de ML).
  const candidates = await prisma.mlPostSaleMessage.findMany({
    where: {
      status: MlPostSaleStatus.SENT,
      moderationReason: { contains: FALLBACK_MARKER },
      autoReplyStatus: null,
      alertedAt: null,
      sentAt: { gte: since },
    },
  })

  for (const rec of candidates) {
    try {
      const thread = await getPackMessages(rec.packId)
      const sentMs = rec.sentAt?.getTime() ?? 0
      const buyerMsgs = thread.filter((m) => {
        if (String(m.from?.user_id ?? '') === sellerId) return false
        const t = m.message_date?.created ? Date.parse(m.message_date.created) : NaN
        return !Number.isNaN(t) && t > sentMs
      })
      if (buyerMsgs.length === 0) continue

      const last = buyerMsgs[buyerMsgs.length - 1]
      const lastMs = Date.parse(last.message_date!.created!)
      if (Date.now() - lastMs < REPLY_GRACE_MS) continue

      if (Date.now() - lastMs <= REPAIR_WINDOW_MS && last.from?.user_id != null) {
        const outcome = await claimAndSendAutoReply(rec, last.from.user_id)
        if (outcome === 'sent') {
          repaired++
          alerts.push(
            `pack ${rec.packId}: el comprador respondió (${fmtAr(lastMs)}) y el auto-reply no había salido (notificación perdida). REPARADO: texto de rangos enviado ahora.`
          )
        } else if (outcome === 'already_claimed') {
          continue // el webhook llegó en el medio, todo bien
        } else {
          alerts.push(
            `pack ${rec.packId}: reply del comprador sin auto-reply y el reintento terminó en ${outcome.toUpperCase()} — revisar a mano.`
          )
        }
      } else {
        alerts.push(
          `pack ${rec.packId}: el comprador respondió (${fmtAr(lastMs)}) y nunca recibió el auto-reply; muy viejo para reenviar automáticamente — revisar a mano.`
        )
      }
      alertIds.add(rec.id)
    } catch (e) {
      logger.error(`[ML Sweep] Error chequeando hilo pack=${rec.packId}`, e)
    }
  }

  // 2. Estados de error sin alertar (envío original o auto-reply).
  const failed = await prisma.mlPostSaleMessage.findMany({
    where: {
      alertedAt: null,
      createdAt: { gte: since },
      OR: [
        { status: { in: [MlPostSaleStatus.MODERATED, MlPostSaleStatus.FAILED] } },
        {
          autoReplyStatus: { in: [MlAutoReplyStatus.MODERATED, MlAutoReplyStatus.FAILED] },
        },
        {
          autoReplyStatus: MlAutoReplyStatus.SENDING,
          autoReplyAt: { lt: new Date(Date.now() - STUCK_SENDING_MS) },
        },
      ],
    },
  })

  for (const rec of failed) {
    if (alertIds.has(rec.id)) continue // ya alertado arriba en esta corrida
    const detail = rec.autoReplyError ?? rec.moderationReason ?? ''
    alerts.push(
      `pack ${rec.packId}: status=${rec.status}, autoReply=${rec.autoReplyStatus ?? '-'}${detail ? ` (${detail})` : ''} — revisar a mano.`
    )
    alertIds.add(rec.id)
  }

  // 3. Un mail con todo + sellar los alertados.
  if (alerts.length > 0) {
    const to = process.env.ML_ALERT_EMAIL ?? 'ventas@val-ar.com.ar'
    const subject = `[ERP] Post-venta ML: ${alerts.length} aviso(s) (${repaired} auto-reparado(s))`
    const html =
      `<p>El chequeo de mensajería post-venta de ML (cada 30 min) detectó:</p>` +
      `<ul>${alerts.map((a) => `<li>${a}</li>`).join('')}</ul>` +
      `<p>Los packs "revisar a mano" se ven en la tabla ml_post_sale_messages y en el hilo de la venta en ML. Cada pack se avisa una sola vez.</p>`
    try {
      await sendMail({ to, subject, html, text: alerts.join('\n') })
      logger.warn(`[ML Sweep] ${alerts.length} alerta(s) enviadas a ${to}`)
    } catch (e) {
      // Sin mail no sellamos: que reintente en la próxima corrida.
      logger.error('[ML Sweep] No se pudo enviar el mail de alertas', e)
      return { checked: candidates.length, repaired, alerted: 0 }
    }
    await prisma.mlPostSaleMessage.updateMany({
      where: { id: { in: [...alertIds] } },
      data: { alertedAt: new Date() },
    })
  }

  return { checked: candidates.length, repaired, alerted: alerts.length }
}

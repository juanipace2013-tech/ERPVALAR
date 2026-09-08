/**
 * Alerta de ventas de ML con envío a una provincia bloqueada.
 *
 * No despachamos a Misiones (régimen de área aduanera especial): esas ventas
 * hay que anularlas apenas entran. checkBlockedShipping corre dentro de
 * handlePostSale para CADA orden paga, antes del gating de reglas de
 * mensajería:
 *   1. Trae el shipment de la orden y mira receiver_address.state.
 *   2. Si la provincia está bloqueada, crea MlShippingAlert (UNIQUE en
 *      orderId = idempotencia). El registro PENDING pinta el cartel rojo en
 *      el layout del ERP (MlShippingAlertBanner) hasta que se marca resuelta.
 *   3. Manda mail inmediato a ML_ALERT_EMAIL (default ventas@val-ar.com.ar).
 *
 * Nunca lanza: un fallo acá no debe frenar la mensajería post-venta.
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { sendMail } from '@/lib/email/microsoft-graph'
import { getShipment, MlApiError, type MlOrder } from './client'

// state.id de ML (ISO 3166-2) -> nombre. Agregar acá si se bloquea otra
// provincia (ej Tierra del Fuego sería "AR-V").
const BLOCKED_STATES: Record<string, string> = {
  'AR-N': 'Misiones',
}

export async function checkBlockedShipping(order: MlOrder, packId: string): Promise<void> {
  try {
    const orderId = String(order.id)

    // ML notifica la misma orden varias veces; si ya hay alerta no volvemos
    // a pegarle a /shipments.
    const already = await prisma.mlShippingAlert.findUnique({ where: { orderId } })
    if (already) return

    const shipmentId = order.shipping?.id
    if (!shipmentId) return // retiro en persona / envío a convenir

    const shipment = await getShipment(shipmentId)
    const state = shipment.receiver_address?.state
    const stateId = state?.id ?? ''
    const stateName = (state?.name ?? '').trim()
    // Matcheamos por id (estable) y por nombre como red de seguridad.
    const blockedName =
      BLOCKED_STATES[stateId] ??
      Object.values(BLOCKED_STATES).find((n) => n.toLowerCase() === stateName.toLowerCase())
    if (!blockedName) return

    const buyerName =
      [order.buyer?.first_name, order.buyer?.last_name].filter(Boolean).join(' ') ||
      order.buyer?.nickname ||
      null
    const itemsSummary = order.order_items
      .map((oi) => `${oi.quantity ?? 1}x ${oi.item?.title ?? oi.item?.id ?? '?'}`)
      .join(' | ')
      .slice(0, 1000)
    const city = shipment.receiver_address?.city?.name ?? null

    let alert
    try {
      alert = await prisma.mlShippingAlert.create({
        data: {
          orderId,
          packId,
          shipmentId: String(shipmentId),
          stateId: stateId || 'AR-N',
          stateName: stateName || blockedName,
          city,
          buyerName,
          itemsSummary,
        },
      })
    } catch {
      // UNIQUE de orderId: otra notificación de la misma orden la creó en
      // paralelo. Idempotencia, no un error.
      return
    }

    logger.warn(
      `[ML Envíos] Venta ${orderId} con envío a ${blockedName} (${city ?? 's/ciudad'}) — ANULAR. Alerta creada.`
    )

    const to = process.env.ML_ALERT_EMAIL ?? 'ventas@val-ar.com.ar'
    const mlLink = `https://www.mercadolibre.com.ar/ventas/${orderId}/detalle`
    const subject = `[ERP] ⛔ Venta ML #${orderId} con envío a ${blockedName} — ANULAR`
    const html =
      `<p><strong>Entró una venta de ML con envío a ${blockedName}. No despachamos a esa provincia: hay que anular la venta.</strong></p>` +
      `<ul>` +
      `<li>Venta: <a href="${mlLink}">#${orderId}</a></li>` +
      `<li>Comprador: ${buyerName ?? '-'}</li>` +
      `<li>Destino: ${city ? `${city}, ` : ''}${stateName || blockedName}</li>` +
      `<li>Productos: ${itemsSummary || '-'}</li>` +
      `</ul>` +
      `<p>El ERP muestra un cartel rojo con esta venta hasta que se marque como resuelta.</p>`
    const text =
      `Venta ML #${orderId} con envío a ${blockedName} — ANULAR.\n` +
      `Comprador: ${buyerName ?? '-'}\nDestino: ${city ? `${city}, ` : ''}${stateName || blockedName}\n` +
      `Productos: ${itemsSummary || '-'}\n${mlLink}`

    try {
      await sendMail({ to, subject, html, text })
      await prisma.mlShippingAlert.update({
        where: { id: alert.id },
        data: { emailSentAt: new Date() },
      })
    } catch (e) {
      // Sin mail igual queda el cartel en el ERP; no reintentamos.
      logger.error(`[ML Envíos] No se pudo mandar el mail de la venta ${orderId}`, e)
    }
  } catch (err) {
    const detail = err instanceof MlApiError ? JSON.stringify(err.body) : String(err)
    logger.error(`[ML Envíos] Error chequeando envío de la orden ${order.id}`, detail)
  }
}

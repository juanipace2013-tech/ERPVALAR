/**
 * Webhook receptor de change notifications de Microsoft Graph.
 *
 * POST /api/webhooks/microsoft-graph
 *   Dos flujos posibles según el request:
 *   1. Validación: Graph manda POST con ?validationToken=XYZ al crear la
 *      subscription. Debemos responder en <10s con text/plain = XYZ.
 *   2. Notificación: Graph manda POST con body
 *      { value: [{ subscriptionId, resource, changeType, clientState, resourceData: { id } }] }
 *      Validamos clientState, traemos el mensaje completo, y lo guardamos
 *      en la bandeja.
 *
 * Variables de entorno:
 *   GRAPH_WEBHOOK_CLIENT_STATE  — secreto compartido que Graph nos devuelve
 *                                 en cada notificación. Se setea al crear
 *                                 la subscription.
 *   AZURE_MAIL_FROM             — UPN de la casilla (fallback para resolver
 *                                 el resource cuando viene con GUID).
 *
 * Docs: https://learn.microsoft.com/en-us/graph/webhooks
 */

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { fetchMessage, parseResourceMessageId } from '@/lib/inbox/graph-mail'
import { getOrCreateMailAccount, ingestInboundMessage } from '@/lib/inbox/conversations'
import { analyzeConversation } from '@/lib/inbox/ai/analyze'
import { ChannelType } from '@prisma/client'

interface GraphChangeNotification {
  subscriptionId: string
  subscriptionExpirationDateTime?: string
  changeType: string
  resource: string
  resourceData?: { id?: string; '@odata.type'?: string }
  clientState?: string
  tenantId?: string
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const validationToken = url.searchParams.get('validationToken')

  // 1. Validación de subscription
  if (validationToken) {
    logger.info('[Graph Webhook] Validación de subscription')
    return new NextResponse(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  // 2. Notificación
  let payload: { value?: GraphChangeNotification[] }
  try {
    payload = await req.json()
  } catch (e) {
    logger.error('[Graph Webhook] JSON inválido', e)
    return NextResponse.json({ ok: true })
  }

  const expectedClientState = process.env.GRAPH_WEBHOOK_CLIENT_STATE
  const mailFromUpn = process.env.AZURE_MAIL_FROM || ''

  // Responder 202 rápido para no provocar reintentos de Graph
  const notifications = payload.value ?? []
  ;(async () => {
    for (const notif of notifications) {
      try {
        if (expectedClientState && notif.clientState !== expectedClientState) {
          logger.warn(`[Graph Webhook] clientState inválido subscription=${notif.subscriptionId}`)
          continue
        }
        if (notif.changeType !== 'created') continue

        const messageId = notif.resourceData?.id ?? parseResourceMessageId(notif.resource)
        if (!messageId) {
          logger.warn(`[Graph Webhook] No se pudo extraer messageId de resource ${notif.resource}`)
          continue
        }

        // Para fetch necesitamos el UPN. Si el resource trae GUID usamos el de .env.
        const userKey = mailFromUpn
        const message = await fetchMessage(userKey, messageId)

        const account = await getOrCreateMailAccount(userKey)
        const fromAddr = message.from?.emailAddress?.address?.toLowerCase() ?? ''
        if (!fromAddr) {
          logger.warn(`[Graph Webhook] Mensaje sin from id=${messageId}`)
          continue
        }

        const isHtml = message.body?.contentType === 'html'
        const ingestResult = await ingestInboundMessage({
          channelAccountId: account.id,
          channelType: ChannelType.EMAIL,
          conversationExternalId: message.conversationId,
          contactName: message.from?.emailAddress?.name ?? null,
          contactIdentifier: fromAddr,
          subject: message.subject ?? null,
          externalId: message.id,
          body: message.bodyPreview ?? (isHtml ? '' : message.body?.content ?? ''),
          bodyHtml: isHtml ? message.body?.content ?? null : null,
          attachments: message.hasAttachments
            ? ([{ kind: 'pending-fetch', externalMessageId: message.id }] as never)
            : null,
          fromName: message.from?.emailAddress?.name ?? null,
          fromAddress: fromAddr,
          inReplyToExternalId: message.internetMessageId ?? null,
          sentAt: message.receivedDateTime ? new Date(message.receivedDateTime) : null,
        })

        // Disparo del agente IA — fire-and-forget. Si falla, queda la
        // conversación sin análisis y Santiago puede pegarle al botón
        // "Re-analizar" desde la UI. NO bloqueamos el 202 a Graph ni
        // hacemos retry automático.
        if (!ingestResult.deduped) {
          analyzeConversation(ingestResult.conversationId).catch((err) =>
            logger.error(
              `[Graph Webhook] AI analyze falló conversation=${ingestResult.conversationId}`,
              err
            )
          )
        }
      } catch (e) {
        logger.error('[Graph Webhook] Error procesando notificación', e)
      }
    }
  })().catch((e) => logger.error('[Graph Webhook] Error de fondo', e))

  return new NextResponse(null, { status: 202 })
}

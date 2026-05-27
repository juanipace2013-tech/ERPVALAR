/**
 * Webhook receptor de WhatsApp Cloud API (Meta).
 *
 * GET  /api/webhooks/whatsapp
 *   Verificación al dar de alta el webhook en Meta — devuelve `hub.challenge`
 *   si el `hub.verify_token` coincide con META_WHATSAPP_VERIFY_TOKEN.
 *
 * POST /api/webhooks/whatsapp
 *   Recibe los eventos (messages, statuses). Valida la firma X-Hub-Signature-256
 *   con META_WHATSAPP_APP_SECRET. Persiste mensajes entrantes en la bandeja.
 *   Siempre responde 200 — Meta reintenta agresivamente si recibe error.
 *
 * Variables de entorno requeridas:
 *   META_WHATSAPP_VERIFY_TOKEN  — token elegido por nosotros, lo configuramos en Meta
 *   META_WHATSAPP_APP_SECRET    — App Secret de la app de Meta (firma HMAC)
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { logger } from '@/lib/logger'
import { getOrCreateWhatsAppAccount, ingestInboundMessage } from '@/lib/inbox/conversations'
import { ChannelType } from '@prisma/client'

// ─── GET: verificación de Meta ──────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  const expected = process.env.META_WHATSAPP_VERIFY_TOKEN

  if (mode === 'subscribe' && token && expected && token === expected) {
    logger.info('[WhatsApp Webhook] Verificación OK')
    return new NextResponse(challenge ?? '', { status: 200 })
  }

  logger.warn('[WhatsApp Webhook] Verificación rechazada')
  return new NextResponse('Forbidden', { status: 403 })
}

// ─── POST: eventos ──────────────────────────────────────────────────────────

interface WhatsAppMessage {
  from: string
  id: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string; sha256?: string }
  audio?: { id: string; mime_type: string }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  sticker?: { id: string; mime_type: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  reaction?: { message_id: string; emoji: string }
  context?: { from?: string; id?: string }
}

interface WhatsAppContact {
  profile?: { name?: string }
  wa_id: string
}

interface WhatsAppChange {
  value: {
    messaging_product: string
    metadata?: { display_phone_number?: string; phone_number_id?: string }
    contacts?: WhatsAppContact[]
    messages?: WhatsAppMessage[]
    statuses?: Array<{ id: string; status: string; timestamp: string; recipient_id: string }>
  }
  field: string
}

interface WhatsAppPayload {
  object: string
  entry?: Array<{ id: string; changes?: WhatsAppChange[] }>
}

/** Verifica la firma HMAC-SHA256 que manda Meta en X-Hub-Signature-256. */
function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.META_WHATSAPP_APP_SECRET
  if (!secret) {
    logger.warn('[WhatsApp Webhook] META_WHATSAPP_APP_SECRET no configurado — omitiendo verificación de firma')
    return true // dev mode — permitir; en prod debería ser exigido
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const provided = signatureHeader.slice('sha256='.length)
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'))
  } catch {
    return false
  }
}

/** Extrae el cuerpo legible de un mensaje WhatsApp según su tipo. */
function extractMessageBody(msg: WhatsAppMessage): { body: string; attachments: unknown[] | null } {
  switch (msg.type) {
    case 'text':
      return { body: msg.text?.body ?? '', attachments: null }
    case 'image':
      return {
        body: msg.image?.caption ? msg.image.caption : '[Imagen]',
        attachments: [{ kind: 'image', externalId: msg.image?.id, mime: msg.image?.mime_type }],
      }
    case 'video':
      return {
        body: msg.video?.caption ? msg.video.caption : '[Video]',
        attachments: [{ kind: 'video', externalId: msg.video?.id, mime: msg.video?.mime_type }],
      }
    case 'audio':
      return {
        body: '[Audio]',
        attachments: [{ kind: 'audio', externalId: msg.audio?.id, mime: msg.audio?.mime_type }],
      }
    case 'document':
      return {
        body: msg.document?.caption || msg.document?.filename || '[Documento]',
        attachments: [
          {
            kind: 'document',
            externalId: msg.document?.id,
            mime: msg.document?.mime_type,
            filename: msg.document?.filename,
          },
        ],
      }
    case 'sticker':
      return { body: '[Sticker]', attachments: [{ kind: 'sticker', externalId: msg.sticker?.id }] }
    case 'location':
      return {
        body: `[Ubicación] ${msg.location?.name ?? ''} (${msg.location?.latitude}, ${msg.location?.longitude})`,
        attachments: null,
      }
    case 'reaction':
      return { body: `[Reacción ${msg.reaction?.emoji}]`, attachments: null }
    default:
      return { body: `[Mensaje tipo ${msg.type}]`, attachments: null }
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-hub-signature-256')

  if (!verifySignature(rawBody, signature)) {
    logger.warn('[WhatsApp Webhook] Firma inválida')
    return new NextResponse('Forbidden', { status: 403 })
  }

  let payload: WhatsAppPayload
  try {
    payload = JSON.parse(rawBody)
  } catch (e) {
    logger.error('[WhatsApp Webhook] JSON inválido', e)
    return NextResponse.json({ ok: true }) // 200 para no provocar reintentos
  }

  // Procesamos sin bloquear la respuesta — Meta espera 200 rápido
  try {
    await processPayload(payload)
  } catch (e) {
    logger.error('[WhatsApp Webhook] Error procesando payload', e)
  }

  return NextResponse.json({ ok: true })
}

async function processPayload(payload: WhatsAppPayload) {
  if (payload.object !== 'whatsapp_business_account') return
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const value = change.value
      const phoneNumberId = value.metadata?.phone_number_id
      if (!phoneNumberId) {
        logger.warn('[WhatsApp Webhook] Falta phone_number_id en metadata')
        continue
      }
      const account = await getOrCreateWhatsAppAccount(phoneNumberId, value.metadata?.display_phone_number)

      const contactsByWaId = new Map<string, WhatsAppContact>()
      for (const c of value.contacts ?? []) contactsByWaId.set(c.wa_id, c)

      for (const msg of value.messages ?? []) {
        const contact = contactsByWaId.get(msg.from)
        const { body, attachments } = extractMessageBody(msg)
        await ingestInboundMessage({
          channelAccountId: account.id,
          channelType: ChannelType.WHATSAPP,
          conversationExternalId: msg.from, // usamos el teléfono del contacto como thread id
          contactName: contact?.profile?.name ?? null,
          contactIdentifier: msg.from,
          externalId: msg.id,
          body,
          attachments: attachments as never,
          fromName: contact?.profile?.name ?? null,
          fromAddress: msg.from,
          sentAt: new Date(Number(msg.timestamp) * 1000),
        })
      }

      // statuses (delivered/read) los ignoramos en Fase 1
    }
  }
}

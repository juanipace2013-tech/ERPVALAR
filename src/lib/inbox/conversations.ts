/**
 * Helpers para upsertear conversaciones y agregar mensajes a la bandeja.
 * Se invoca desde los webhooks (WhatsApp y Microsoft Graph).
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { ChannelType, MessageDirection, MessageStatus, Prisma } from '@prisma/client'
import { matchByEmail, matchByPhone, type MatchedContact } from './matching'

export interface IncomingMessageInput {
  channelAccountId: string
  /** ID externo de la conversación (thread). Para WA: teléfono; para mail: conversationId de Graph */
  conversationExternalId: string
  /** Display del contacto */
  contactName?: string | null
  /** Teléfono o email del contacto */
  contactIdentifier: string
  /** Subject del mail (no aplica a WA) */
  subject?: string | null
  /** Identificador del canal (para hacer match) */
  channelType: ChannelType

  // Mensaje
  externalId?: string | null
  body: string
  bodyHtml?: string | null
  attachments?: Prisma.InputJsonValue | null
  fromName?: string | null
  fromAddress: string
  inReplyToExternalId?: string | null
  sentAt?: Date | null
}

/**
 * Inserta un mensaje entrante. Crea la Conversation si no existe,
 * o actualiza su lastMessageAt y unreadCount.
 *
 * Idempotente: si ya existe un Message con el mismo `externalId`, no hace nada.
 */
export async function ingestInboundMessage(input: IncomingMessageInput) {
  // Dedupe por externalId
  if (input.externalId) {
    const existing = await prisma.message.findUnique({
      where: { externalId: input.externalId },
      select: { id: true, conversationId: true },
    })
    if (existing) {
      logger.info(`[Inbox] Mensaje duplicado ignorado externalId=${input.externalId}`)
      return { messageId: existing.id, conversationId: existing.conversationId, deduped: true }
    }
  }

  // Match a CRM
  const matched: MatchedContact =
    input.channelType === ChannelType.WHATSAPP
      ? await matchByPhone(input.contactIdentifier)
      : await matchByEmail(input.contactIdentifier)

  const displayName = input.contactName || matched.displayName || input.contactIdentifier

  // Upsert conversation
  const conversation = await prisma.conversation.upsert({
    where: {
      channelAccountId_externalId: {
        channelAccountId: input.channelAccountId,
        externalId: input.conversationExternalId,
      },
    },
    create: {
      channelAccountId: input.channelAccountId,
      externalId: input.conversationExternalId,
      contactName: displayName,
      contactIdentifier: input.contactIdentifier,
      subject: input.subject ?? null,
      customerId: matched.customerId,
      contactId: matched.contactId,
      lastMessageAt: input.sentAt ?? new Date(),
      unreadCount: 1,
    },
    update: {
      // Actualizamos display si no estaba seteado o vino algo nuevo
      contactName: displayName,
      // Re-link a CRM si antes no estaba matcheado y ahora sí
      customerId: matched.customerId ?? undefined,
      contactId: matched.contactId ?? undefined,
      lastMessageAt: input.sentAt ?? new Date(),
      unreadCount: { increment: 1 },
      status: 'OPEN',
    },
  })

  // Crear el mensaje
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      externalId: input.externalId ?? null,
      direction: MessageDirection.INBOUND,
      status: MessageStatus.RECEIVED,
      body: input.body,
      bodyHtml: input.bodyHtml ?? null,
      attachments: input.attachments ?? Prisma.JsonNull,
      fromName: input.fromName ?? displayName,
      fromAddress: input.fromAddress,
      inReplyToExternalId: input.inReplyToExternalId ?? null,
      sentAt: input.sentAt ?? new Date(),
    },
  })

  logger.info(
    `[Inbox] Mensaje recibido conversation=${conversation.id} channel=${input.channelType} from=${input.fromAddress}`
  )

  return { messageId: message.id, conversationId: conversation.id, deduped: false }
}

/** Busca (o crea) el ChannelAccount de WhatsApp con el `phone_number_id` de Meta. */
export async function getOrCreateWhatsAppAccount(phoneNumberId: string, displayPhone?: string) {
  return prisma.channelAccount.upsert({
    where: {
      type_identifier: {
        type: ChannelType.WHATSAPP,
        identifier: phoneNumberId,
      },
    },
    create: {
      type: ChannelType.WHATSAPP,
      identifier: phoneNumberId,
      name: displayPhone ? `WhatsApp ${displayPhone}` : `WhatsApp ${phoneNumberId}`,
    },
    update: {},
  })
}

/** Busca (o crea) el ChannelAccount de mail para una casilla (UPN/M365). */
export async function getOrCreateMailAccount(upn: string) {
  return prisma.channelAccount.upsert({
    where: {
      type_identifier: {
        type: ChannelType.EMAIL,
        identifier: upn.toLowerCase(),
      },
    },
    create: {
      type: ChannelType.EMAIL,
      identifier: upn.toLowerCase(),
      name: upn,
    },
    update: {},
  })
}

/**
 * Redactor de borrador — Sonnet 4.6 con prompt caching en el system prompt.
 *
 * Recibe la categoría detectada por el clasificador + el thread reciente y
 * devuelve un borrador de respuesta en español formal "usted", sin firma.
 */

import { logger } from '@/lib/logger'
import { MessageCategory } from '@prisma/client'
import { getInboxAnthropicClient } from './client'
import { SONNET_MODEL_ID, calculateCostUsd, type TokenUsage } from './pricing'
import { DRAFTER_SYSTEM_PROMPT } from './prompts'

export interface DrafterMessage {
  direction: 'INBOUND' | 'OUTBOUND'
  body: string
  fromName?: string | null
  sentAt?: Date | null
}

export interface DrafterInput {
  category: MessageCategory
  categorySummary?: string
  channelType: 'EMAIL' | 'WHATSAPP'
  /** Los mensajes en orden cronológico ASC, el último es el que hay que responder */
  thread: DrafterMessage[]
  /** Display del contacto y, si está vinculado, el cliente del CRM */
  contactName?: string | null
  customerName?: string | null
  subject?: string | null
}

export interface DrafterResult {
  draft: string
  model: string
  usage: TokenUsage
  costUsd: number
}

function formatThread(thread: DrafterMessage[]): string {
  return thread
    .map((m) => {
      const who = m.direction === 'INBOUND' ? (m.fromName || 'Cliente') : 'VAL ARG'
      const when = m.sentAt ? m.sentAt.toISOString().slice(0, 16).replace('T', ' ') : ''
      return `[${when}] ${who} (${m.direction}):\n${m.body.trim()}`
    })
    .join('\n\n---\n\n')
}

export async function draftReply(input: DrafterInput): Promise<DrafterResult> {
  const client = getInboxAnthropicClient()

  const userParts: string[] = []
  userParts.push(`Categoría detectada: ${input.category}`)
  if (input.categorySummary) userParts.push(`Resumen IA: ${input.categorySummary}`)
  userParts.push(`Canal: ${input.channelType}`)
  if (input.subject) userParts.push(`Asunto: ${input.subject}`)
  if (input.customerName) userParts.push(`Cliente VAL ARG: ${input.customerName}`)
  else userParts.push('Cliente VAL ARG: (no vinculado en el CRM)')
  if (input.contactName) userParts.push(`Contacto: ${input.contactName}`)
  userParts.push('')
  userParts.push('Hilo de la conversación (más viejo arriba, último entrante es el que hay que responder):')
  userParts.push('')
  userParts.push(formatThread(input.thread))
  userParts.push('')
  userParts.push(
    'Redactá SOLO el cuerpo del borrador. Sin saludo formal innecesario, sin firma, sin cierre. Texto plano.'
  )

  const response = await client.messages.create({
    model: SONNET_MODEL_ID,
    max_tokens: 800,
    system: [
      {
        type: 'text',
        text: DRAFTER_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userParts.join('\n') }],
  })

  // Extraer texto del primer text block
  const textBlock = response.content.find(
    (b): b is { type: 'text'; text: string } & typeof b => b.type === 'text'
  )
  if (!textBlock) {
    logger.error('[ai/drafter] Respuesta sin text block', response)
    throw new Error('Drafter no devolvió texto')
  }

  const usage: TokenUsage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? null,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? null,
  }

  return {
    draft: textBlock.text.trim(),
    model: SONNET_MODEL_ID,
    usage,
    costUsd: calculateCostUsd(SONNET_MODEL_ID, usage),
  }
}

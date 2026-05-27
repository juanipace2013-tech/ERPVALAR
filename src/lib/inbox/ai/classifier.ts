/**
 * Clasificador de mensajes — Haiku 4.5 con tool_use forzado para devolver
 * JSON estricto (sin parseo manual de texto libre).
 *
 * Devuelve también el usage + costo en USD para que el orquestador los persista.
 */

import { logger } from '@/lib/logger'
import { MessageCategory } from '@prisma/client'
import type Anthropic from '@anthropic-ai/sdk'
import { getInboxAnthropicClient } from './client'
import { HAIKU_MODEL_ID, calculateCostUsd, type TokenUsage } from './pricing'
import { CLASSIFIER_SYSTEM_PROMPT } from './prompts'

const CATEGORIES = ['COTIZACION', 'CONSULTA', 'QUEJA', 'PAGO', 'OTRO'] as const

const classifyTool: Anthropic.Messages.Tool = {
  name: 'classify_message',
  description:
    'Clasifica un mensaje entrante en una categoría, devuelve confianza y resumen.',
  input_schema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: CATEGORIES as unknown as string[],
        description: 'Una de las 5 categorías definidas en las instrucciones.',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Confianza entre 0 y 1.',
      },
      summary: {
        type: 'string',
        description:
          'Una sola frase en español, máx 150 caracteres, en tercera persona.',
      },
    },
    required: ['category', 'confidence', 'summary'],
  },
}

export interface ClassifierResult {
  category: MessageCategory
  confidence: number
  summary: string
  model: string
  usage: TokenUsage
  costUsd: number
}

export interface ClassifierInput {
  /** Mensaje a clasificar (texto plano del último entrante) */
  messageBody: string
  /** "EMAIL" | "WHATSAPP" — opcional, ayuda al modelo a calibrar */
  channelType?: string
  /** Subject del mail (si aplica) */
  subject?: string | null
  /** Nombre del remitente (si lo sabemos) */
  contactName?: string | null
}

export async function classifyMessage(input: ClassifierInput): Promise<ClassifierResult> {
  const client = getInboxAnthropicClient()

  const userParts: string[] = []
  if (input.channelType) userParts.push(`Canal: ${input.channelType}`)
  if (input.contactName) userParts.push(`Remitente: ${input.contactName}`)
  if (input.subject) userParts.push(`Asunto: ${input.subject}`)
  userParts.push('')
  userParts.push('Mensaje recibido:')
  userParts.push('"""')
  userParts.push(input.messageBody || '(mensaje vacío)')
  userParts.push('"""')

  const response = await client.messages.create({
    model: HAIKU_MODEL_ID,
    max_tokens: 256,
    system: [
      {
        type: 'text',
        text: CLASSIFIER_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [classifyTool],
    tool_choice: { type: 'tool', name: 'classify_message' },
    messages: [{ role: 'user', content: userParts.join('\n') }],
  })

  // Buscar el tool_use block
  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use'
  )

  if (!toolUse) {
    logger.error('[ai/classifier] Respuesta sin tool_use', response)
    throw new Error('Clasificador no devolvió tool_use')
  }

  const raw = toolUse.input as { category?: string; confidence?: number; summary?: string }

  if (!raw.category || !CATEGORIES.includes(raw.category as (typeof CATEGORIES)[number])) {
    throw new Error(`Categoría inválida del clasificador: ${raw.category}`)
  }

  const usage: TokenUsage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? null,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? null,
  }

  return {
    category: raw.category as MessageCategory,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
    summary: (raw.summary || '').slice(0, 200),
    model: HAIKU_MODEL_ID,
    usage,
    costUsd: calculateCostUsd(HAIKU_MODEL_ID, usage),
  }
}

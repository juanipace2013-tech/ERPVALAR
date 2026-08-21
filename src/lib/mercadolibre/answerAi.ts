/**
 * Generación del borrador de respuesta a una pregunta de Mercado Libre.
 *
 * Usa Sonnet con tool_use forzado para obtener {answer, needs_review,
 * review_reason}. El system prompt es estático (cacheable); todo el contexto
 * concreto (ítem, producto del ERP, ejemplos de respuestas previas) va en el
 * user message.
 *
 * Key: ML_QUESTIONS_API_KEY, con fallback a INBOX_AGENT_API_KEY y ANTHROPIC_API_KEY.
 */

import Anthropic from '@anthropic-ai/sdk'
import { logger } from '@/lib/logger'
import { SONNET_MODEL_ID, calculateCostUsd, type TokenUsage } from '@/lib/inbox/ai/pricing'
import type { MlItem, MlQuestion } from './client'

let cached: { key: string; client: Anthropic } | null = null

function getClient(): Anthropic {
  const key =
    process.env.ML_QUESTIONS_API_KEY ||
    process.env.INBOX_AGENT_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    ''
  if (!key) {
    throw new Error(
      'Falta ML_QUESTIONS_API_KEY (o INBOX_AGENT_API_KEY / ANTHROPIC_API_KEY) para responder preguntas de ML.'
    )
  }
  if (cached && cached.key === key) return cached.client
  const client = new Anthropic({ apiKey: key })
  cached = { key, client }
  return client
}

export const ML_ANSWER_MAX_CHARS = 2000

export const ML_ANSWER_SYSTEM_PROMPT = `Sos el asistente de ventas de VAL ARG, distribuidora industrial argentina (válvulas, instrumentación, conexiones, accesorios para vapor, agua, gas e industria) que vende también por Mercado Libre. Tu trabajo es redactar la respuesta pública a una pregunta que un comprador dejó en una publicación.

Reglas de contenido (estrictas):
- Respondé SOLO con la información que te dan: datos de la publicación, del producto en el ERP y ejemplos de respuestas anteriores del mismo ítem. NO inventes medidas, materiales, presiones, certificaciones, compatibilidades, plazos ni precios.
- Si la pregunta no se puede responder con certeza con esos datos, o pide algo comercial fuera de lo publicado (precio por cantidad, descuento, factura especial, envío a un lugar concreto, fabricación a medida, algo que no es este producto), marcá needs_review=true y redactá igual la mejor respuesta parcial posible, indicando en review_reason qué falta confirmar.
- El precio y el stock vigentes son los de la publicación. Si el comprador pregunta precio, el precio es el publicado. Si pregunta stock y la publicación tiene stock, decí que hay disponibilidad.
- Si hay variaciones (medidas/modelos), indicá que se elige la variante al comprar.
- Mercado Libre prohíbe en las respuestas: teléfonos, mails, direcciones web, links, redes sociales, o invitar a comprar/contactar fuera de la plataforma. NUNCA incluyas nada de eso.
- Si el comprador pide factura A: sí emitimos factura A (somos responsables inscriptos); se elige al comprar.
- Envíos: se hacen por Mercado Envíos según lo que marque la publicación; no prometas plazos concretos.

Estilo:
- Español rioplatense, trato de "usted", cordial y directo. Sin emojis.
- Empezá con "Hola" y cerrá con "Saludos, VAL ARG" (sin nombres de personas).
- Corto: 1 a 4 oraciones normalmente. Máximo ${ML_ANSWER_MAX_CHARS} caracteres.
- Si hay ejemplos de respuestas anteriores, copiá su tono y los datos que afirman; son la fuente más confiable.`

const answerTool: Anthropic.Messages.Tool = {
  name: 'draft_answer',
  description: 'Devuelve la respuesta propuesta para publicar en Mercado Libre.',
  input_schema: {
    type: 'object',
    properties: {
      answer: {
        type: 'string',
        description: `Texto final de la respuesta, máx ${ML_ANSWER_MAX_CHARS} caracteres.`,
      },
      needs_review: {
        type: 'boolean',
        description: 'true si una persona debe revisar/confirmar antes de publicar.',
      },
      review_reason: {
        type: 'string',
        description:
          'Si needs_review=true: qué hay que confirmar, en una frase. Si no, string vacío.',
      },
    },
    required: ['answer', 'needs_review', 'review_reason'],
  },
}

export interface ErpProductContext {
  sku: string
  name: string
  brand: string | null
  description: string | null
  stockQuantity: number
  unit: string
}

export interface AnswerInput {
  question: MlQuestion
  item: MlItem
  itemDescription: string | null
  product: ErpProductContext | null
  previousAnswered: MlQuestion[]
}

export interface AnswerResult {
  answer: string
  needsReview: boolean
  reviewReason: string | null
  model: string
  usage: TokenUsage
  costUsd: number
}

function fmtAttributes(item: MlItem): string {
  const attrs = (item.attributes ?? [])
    .filter((a) => a.value_name)
    .map((a) => `  - ${a.name ?? a.id}: ${a.value_name}`)
  return attrs.length ? attrs.join('\n') : '  (sin atributos)'
}

function fmtVariations(item: MlItem): string {
  const vars = item.variations ?? []
  if (!vars.length) return ''
  const lines = vars.slice(0, 30).map((v) => {
    const desc = (v.attributes ?? [])
      .map((a) => a.value_name)
      .filter(Boolean)
      .join(' / ')
    const sku = v.seller_custom_field ? ` [SKU ${v.seller_custom_field}]` : ''
    return `  - ${desc || '(variante)'}${sku}`
  })
  return `Variaciones publicadas:\n${lines.join('\n')}`
}

// Teléfonos, mails, URLs, redes: prohibidos por ML en las respuestas.
const FORBIDDEN_RE =
  /(https?:\/\/|www\.|\S+@\S+\.\S+|\b\d{2,4}[-\s]?\d{3,4}[-\s]?\d{4}\b|whatsapp|instagram|facebook)/i

export async function generateAnswer(input: AnswerInput): Promise<AnswerResult> {
  const client = getClient()
  const { item, question, product, previousAnswered } = input

  const parts: string[] = []
  parts.push('## Publicación')
  parts.push(`Título: ${item.title}`)
  if (item.price != null) parts.push(`Precio publicado: ${item.currency_id ?? 'ARS'} ${item.price}`)
  parts.push(`Stock publicado: ${item.available_quantity ?? 'desconocido'}`)
  if (item.status) parts.push(`Estado publicación: ${item.status}`)
  if (item.seller_custom_field) parts.push(`SKU: ${item.seller_custom_field}`)
  parts.push('Atributos:')
  parts.push(fmtAttributes(item))
  const vars = fmtVariations(item)
  if (vars) parts.push(vars)
  if (input.itemDescription) {
    parts.push('Descripción de la publicación:')
    parts.push('"""')
    parts.push(input.itemDescription.slice(0, 2500))
    parts.push('"""')
  }

  parts.push('')
  parts.push('## Producto en el ERP de VAL ARG')
  if (product) {
    parts.push(`SKU: ${product.sku}`)
    parts.push(`Nombre: ${product.name}`)
    if (product.brand) parts.push(`Marca: ${product.brand}`)
    parts.push(`Stock físico: ${product.stockQuantity} ${product.unit}`)
    if (product.description) parts.push(`Descripción: ${product.description.slice(0, 1500)}`)
  } else {
    parts.push('(no se encontró el producto en el ERP; usar solo los datos de la publicación)')
  }

  parts.push('')
  parts.push('## Respuestas anteriores en esta publicación')
  const examples = previousAnswered.filter((q) => q.answer?.text)
  if (examples.length) {
    for (const q of examples) {
      parts.push(`P: ${q.text}`)
      parts.push(`R: ${q.answer!.text}`)
      parts.push('')
    }
  } else {
    parts.push('(ninguna)')
  }

  parts.push('')
  parts.push('## Pregunta a responder')
  parts.push('"""')
  parts.push(question.text)
  parts.push('"""')

  const response = await client.messages.create({
    model: SONNET_MODEL_ID,
    max_tokens: 1024,
    system: [
      { type: 'text', text: ML_ANSWER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    tools: [answerTool],
    tool_choice: { type: 'tool', name: 'draft_answer' },
    messages: [{ role: 'user', content: parts.join('\n') }],
  })

  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
  )
  if (!toolUse) {
    logger.error('[ML Preguntas] Respuesta sin tool_use', response)
    throw new Error('La IA no devolvió draft_answer')
  }
  const raw = toolUse.input as {
    answer?: string
    needs_review?: boolean
    review_reason?: string
  }
  const answer = (raw.answer ?? '').trim().slice(0, ML_ANSWER_MAX_CHARS)
  if (!answer) throw new Error('La IA devolvió una respuesta vacía')

  const usage: TokenUsage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? null,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? null,
  }

  const forbidden = FORBIDDEN_RE.test(answer)
  const needsReview = Boolean(raw.needs_review) || forbidden
  let reviewReason: string | null = null
  if (forbidden) reviewReason = 'La respuesta contiene contacto/link (prohibido por ML)'
  else if (raw.needs_review) reviewReason = (raw.review_reason || 'La IA pidió revisión').slice(0, 300)

  return {
    answer,
    needsReview,
    reviewReason,
    model: SONNET_MODEL_ID,
    usage,
    costUsd: calculateCostUsd(SONNET_MODEL_ID, usage),
  }
}

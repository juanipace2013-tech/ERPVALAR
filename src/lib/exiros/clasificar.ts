/**
 * Re-clasificación de licitaciones con IA (veredicto/confianza/razón).
 *
 * Se usa al importar el Excel de un evento de Ariba: la detección por mail
 * solo trae el título, y con el detalle completo de ítems la clasificación
 * mejora mucho. Reusa el cliente Anthropic de la Bandeja (INBOX_AGENT_API_KEY)
 * con tool_use forzado, mismo patrón que src/lib/inbox/ai/classifier.ts.
 *
 * El catálogo del system prompt es una versión breve del que usa el agente
 * Python externo (que no vive en este repo). Mantener alineados a ojo.
 */

import type Anthropic from '@anthropic-ai/sdk'
import { logger } from '@/lib/logger'
import { getInboxAnthropicClient } from '@/lib/inbox/ai/client'
import { HAIKU_MODEL_ID } from '@/lib/inbox/ai/pricing'
import { EXIROS_VEREDICTOS, type ExirosVeredicto } from './constants'

const SYSTEM_PROMPT = `Sos el clasificador de licitaciones de VAL ARG, distribuidora industrial argentina B2B. Recibís el detalle de una licitación (título e ítems) y decidís si a VAL ARG le conviene cotizarla.

Catálogo de VAL ARG (marcas que distribuye y sus rubros):
- GENEBRE: válvulas esféricas, mariposa, retención, globo, compuerta y accesorios de cañería en latón, bronce e inoxidable. Es la marca estrella — si el pedido menciona GENEBRE o un N/P de GENEBRE, es COTIZAR casi seguro.
- CEPEX: válvulas y accesorios termoplásticos (PVC, PE) para conducción de fluidos.
- WINTERS: instrumentos de medición — manómetros, termómetros, vacuómetros, sellos, accesorios de instrumentación.
- LESER: válvulas de seguridad y alivio de presión.
- BERMAD: válvulas de control hidráulico (reductoras, sostenedoras, altitud).
- KITO: aparejos y polipastos manuales y eléctricos.
- AERRE, CODITAL, CENI: válvulas y accesorios industriales complementarios.

Criterio:
- COTIZAR: la mayoría de los ítems entra en el rubro (válvulas, instrumentos de medición de presión/temperatura, accesorios de cañería, aparejos), aunque pidan otra marca, si existe equivalente razonable de nuestras marcas. Mención explícita de nuestras marcas o sus N/P → COTIZAR.
- DECLINAR: fuera de rubro — repuestos originales de una marca específica ajena (ej: "repuesto p/bomba Grundfos"), oleohidráulica o neumática de automatización (cilindros, electroválvulas de automatización, unidades FRL), material eléctrico, ferretería general, EPP, servicios.
- REVISAR: mezcla de rubros, descripciones ambiguas, o ítems del rubro pero muy especiales (aleaciones exóticas, normas poco habituales).

La razón: 2 a 4 frases en castellano. Nombrá qué ítems matchean con qué marca (si podés, sugerí el artículo, ej "GENEBRE art. 3097") y cuáles quedan fuera de rubro. La confianza es un entero 0-100.

Respondé SIEMPRE invocando la herramienta clasificar_licitacion.`

const clasificarTool: Anthropic.Messages.Tool = {
  name: 'clasificar_licitacion',
  description: 'Devuelve el veredicto comercial sobre una licitación.',
  input_schema: {
    type: 'object',
    properties: {
      veredicto: {
        type: 'string',
        enum: EXIROS_VEREDICTOS as unknown as string[],
        description: 'COTIZAR, REVISAR o DECLINAR.',
      },
      confianza: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: 'Confianza 0-100.',
      },
      razon: {
        type: 'string',
        description: '2-4 frases justificando el veredicto, con matcheo por marca/artículo.',
      },
    },
    required: ['veredicto', 'confianza', 'razon'],
  },
}

export interface ClasificarLicitacionInput {
  titulo: string
  empresa?: string | null
  items: Array<{
    nro: number
    descCorta: string
    descLarga?: string | null
    cantidad?: number | null
    unidad?: string | null
  }>
  requisitos?: string[]
}

export interface ClasificarLicitacionResult {
  veredicto: ExirosVeredicto
  confianza: number
  razon: string
  model: string
}

export async function clasificarLicitacion(
  input: ClasificarLicitacionInput
): Promise<ClasificarLicitacionResult> {
  const client = getInboxAnthropicClient()

  const partes: string[] = []
  if (input.empresa) partes.push(`Comprador: ${input.empresa}`)
  partes.push(`Título de la licitación: ${input.titulo}`)
  partes.push('')
  partes.push(`Ítems (${input.items.length}):`)
  for (const it of input.items) {
    const detalle = [
      it.descCorta,
      it.descLarga && it.descLarga !== it.descCorta ? it.descLarga : null,
      it.cantidad != null ? `Cantidad: ${it.cantidad} ${it.unidad || ''}`.trim() : null,
    ]
      .filter(Boolean)
      .join(' — ')
    partes.push(`${it.nro}. ${detalle}`)
  }
  if (input.requisitos?.length) {
    partes.push('')
    partes.push(`Requisitos de papeleo del evento: ${input.requisitos.join('; ')}`)
  }

  const response = await client.messages.create({
    model: HAIKU_MODEL_ID,
    max_tokens: 512,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [clasificarTool],
    tool_choice: { type: 'tool', name: 'clasificar_licitacion' },
    messages: [{ role: 'user', content: partes.join('\n') }],
  })

  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use'
  )
  if (!toolUse) {
    logger.error('[exiros/clasificar] Respuesta sin tool_use', response)
    throw new Error('El clasificador no devolvió tool_use')
  }

  const raw = toolUse.input as { veredicto?: string; confianza?: number; razon?: string }
  if (!raw.veredicto || !(EXIROS_VEREDICTOS as readonly string[]).includes(raw.veredicto)) {
    throw new Error(`Veredicto inválido del clasificador: ${raw.veredicto}`)
  }

  return {
    veredicto: raw.veredicto as ExirosVeredicto,
    confianza: Math.max(0, Math.min(100, Math.round(raw.confianza ?? 50))),
    razon: (raw.razon || '').trim(),
    model: HAIKU_MODEL_ID,
  }
}

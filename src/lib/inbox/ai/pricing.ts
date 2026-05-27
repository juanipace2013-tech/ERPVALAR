/**
 * Tabla de precios y cálculo de costo en USD para llamadas al agente.
 *
 * Fuente: https://platform.claude.com/docs/en/about-claude/models/overview
 *         https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 *
 * Convenciones:
 *   - Precios en USD por 1.000.000 tokens
 *   - Cache reads = 0.10x del input base (TTL 5min o 1h, mismo precio)
 *   - Cache writes = 1.25x del input base (TTL 5min, default)
 *   - Cache writes 1h = 2.00x del input base (no usado por ahora)
 *
 * NOTA sobre model IDs:
 *   Desde la generación 4.6, los IDs no llevan sufijo de fecha — son snapshots
 *   pineados pero con nombre "limpio" (ver doc oficial). Para Haiku 4.5 sí hay
 *   sufijo. Si Anthropic publica nuevas versiones, hay que actualizar acá.
 */

export const HAIKU_MODEL_ID = 'claude-haiku-4-5-20251001'
export const SONNET_MODEL_ID = 'claude-sonnet-4-6'

interface ModelPricing {
  /** USD por millón de tokens de input (no cacheado) */
  inputPerMTok: number
  /** USD por millón de tokens de output */
  outputPerMTok: number
}

const PRICES: Record<string, ModelPricing> = {
  [HAIKU_MODEL_ID]: { inputPerMTok: 1, outputPerMTok: 5 },
  [SONNET_MODEL_ID]: { inputPerMTok: 3, outputPerMTok: 15 },
}

const CACHE_READ_MULTIPLIER = 0.1
const CACHE_WRITE_5MIN_MULTIPLIER = 1.25

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

/**
 * Calcula el costo de una llamada en USD. Devuelve 0 si el modelo no está en la tabla
 * (con un warning en consola — el cálculo no debería romper el flujo).
 */
export function calculateCostUsd(model: string, usage: TokenUsage): number {
  const price = PRICES[model]
  if (!price) {
    console.warn(`[ai/pricing] Modelo sin precio en tabla: ${model}`)
    return 0
  }

  const input = usage.input_tokens || 0
  const output = usage.output_tokens || 0
  const cacheCreate = usage.cache_creation_input_tokens || 0
  const cacheRead = usage.cache_read_input_tokens || 0

  const inputCost = (input * price.inputPerMTok) / 1_000_000
  const outputCost = (output * price.outputPerMTok) / 1_000_000
  const cacheWriteCost =
    (cacheCreate * price.inputPerMTok * CACHE_WRITE_5MIN_MULTIPLIER) / 1_000_000
  const cacheReadCost =
    (cacheRead * price.inputPerMTok * CACHE_READ_MULTIPLIER) / 1_000_000

  return inputCost + outputCost + cacheWriteCost + cacheReadCost
}

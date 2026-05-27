/**
 * Cliente singleton del SDK de Anthropic para el agente de bandeja.
 *
 * Lee INBOX_AGENT_API_KEY (DEDICADA — separada del ANTHROPIC_API_KEY del OCR).
 * Si la variable no está, getInboxAnthropicClient() tira un error explícito en
 * runtime — los call-sites deben atrapar y dejar la conversación sin análisis,
 * NO romper el webhook.
 *
 * La key se lee en runtime (no a nivel de módulo) por el mismo motivo
 * que microsoft-graph.ts: Next.js/Turbopack resuelve process.env en build time
 * y queda string vacío en producción.
 */

import Anthropic from '@anthropic-ai/sdk'

let cachedClient: { key: string; client: Anthropic } | null = null

export function getInboxAnthropicClient(): Anthropic {
  const key = process.env.INBOX_AGENT_API_KEY || ''
  if (!key) {
    throw new Error(
      'INBOX_AGENT_API_KEY no configurada. Esta es la key dedicada del agente de bandeja, ' +
        'separada de ANTHROPIC_API_KEY (usada por el OCR de facturas). ' +
        'Crear una key nueva en Anthropic Console y agregarla al .env.'
    )
  }
  if (cachedClient && cachedClient.key === key) return cachedClient.client
  const client = new Anthropic({ apiKey: key })
  cachedClient = { key, client }
  return client
}

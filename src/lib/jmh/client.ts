/**
 * Cliente de la tienda pública de JMH (tienda.jmh.com.ar, Odoo eCommerce).
 *
 * La tienda expone sin login el mismo endpoint que usa su página de producto:
 * POST /website_sale/get_combination_info devuelve `free_qty` (cantidad
 * disponible) y `list_price` (lista general en USD) a partir del id de
 * product.template.
 *
 * El mapeo código JMH (= SKU del ERP) -> templateId vive en JmhLink (cargado
 * por scripts/cargar-jmh-links.ts).
 *
 * Caché en memoria de 10 minutos por producto para no castigar su servidor.
 */

import { logger } from '@/lib/logger'

export const JMH_BASE = 'https://tienda.jmh.com.ar'
const CACHE_TTL_MS = 10 * 60 * 1000
const FETCH_TIMEOUT_MS = 12_000

export interface JmhLiveData {
  /** Cantidad disponible; null si la tienda no publica stock de ese artículo */
  stock: number | null
  precioListaUsd: number | null
  /** La tienda deja pedirlo sin existencias ("consulte plazo de entrega") */
  aPedido: boolean
  fetchedAt: string
}

const cache = new Map<number, { at: number; data: JmhLiveData }>()

/** Interpreta la respuesta JSON-RPC de get_combination_info. */
export function parseJmhCombinationInfo(json: unknown): Omit<JmhLiveData, 'fetchedAt'> | null {
  const r = (json as { result?: unknown } | null)?.result
  if (!r || typeof r !== 'object') return null
  const info = r as Record<string, unknown>
  if (typeof info.product_template_id !== 'number') return null

  const qty = Number(info.free_qty)
  const publicaStock = info.is_storable === true && info.show_availability === true && Number.isFinite(qty)
  const precio = Number(info.list_price)
  const moneda = (info.product_tracking_info as { currency?: unknown } | undefined)?.currency
  return {
    stock: publicaStock ? Math.max(0, qty) : null,
    // solo se informa como USD si la tienda dice que es USD
    precioListaUsd: moneda === 'USD' && Number.isFinite(precio) && precio > 0 ? precio : null,
    aPedido: info.allow_out_of_stock_order === true,
  }
}

export async function getJmhLiveData(templateId: number): Promise<JmhLiveData | null> {
  const hit = cache.get(templateId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data

  let res: Response
  try {
    res = await fetch(`${JMH_BASE}/website_sale/get_combination_info`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ERP-ValArg/1.0)',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: {
          product_template_id: templateId,
          product_id: false,
          combination: [],
          add_qty: 1,
          parent_combination: [],
        },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    logger.error(`[JMH] fetch template ${templateId} falló`, err)
    return hit?.data ?? null // caché vencida antes que nada
  }
  if (!res.ok) {
    logger.error(`[JMH] template ${templateId} -> HTTP ${res.status}`)
    return hit?.data ?? null
  }
  let parsed: Omit<JmhLiveData, 'fetchedAt'> | null = null
  try {
    parsed = parseJmhCombinationInfo(await res.json())
  } catch {
    parsed = null
  }
  if (!parsed) {
    logger.error(`[JMH] template ${templateId}: respuesta inesperada (¿cambió la tienda?)`)
    return hit?.data ?? null
  }
  const data: JmhLiveData = { ...parsed, fetchedAt: new Date().toISOString() }
  cache.set(templateId, { at: Date.now(), data })
  return data
}

/**
 * Extrae del HTML del listado de la tienda (/shop?ppg=N) los pares
 * templateId -> código. El código es la referencia interna de JMH, que Odoo
 * pone entre corchetes en el nombre de la imagen: .../product.template/14243/
 * image_512/%5BMN90114RF0010D%5D%2090...
 */
export function parseJmhShopListing(html: string): { templateId: number; codigo: string; nombre: string | null }[] {
  const out: { templateId: number; codigo: string; nombre: string | null }[] = []
  const re = /\/web\/image\/product\.template\/(\d+)\/image_\d+\/([^"?]+)/g
  const seen = new Set<number>()
  for (const m of html.matchAll(re)) {
    const templateId = Number(m[1])
    if (seen.has(templateId)) continue
    let name: string
    try {
      name = decodeURIComponent(m[2])
    } catch {
      continue
    }
    const c = name.match(/^\[([^\]]+)\]\s*(.*)$/)
    if (!c) continue // sin referencia interna: no se puede vincular
    seen.add(templateId)
    out.push({ templateId, codigo: c[1].trim().toUpperCase(), nombre: c[2].trim() || null })
  }
  return out
}

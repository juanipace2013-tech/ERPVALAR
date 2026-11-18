/**
 * Cliente del sitio público de famiq.com.ar.
 *
 * Desde nov-2026 el sitio es Nuxt y ya no expone /producto/{webId}/data: el
 * stock por sucursal viene incrustado en la página del producto, dentro de
 * <script id="__NUXT_DATA__"> (arreglo plano con referencias por índice).
 * Sin login el precio viene en 0 y, para algunos artículos, la cantidad
 * también: en ese caso `stockEnSucursales` igual avisa qué sucursales tienen
 * stock (se informa "con stock" sin cantidad).
 *
 * El webId es el ID interno del sitio; el mapeo código FAMIQ (= SKU del ERP)
 * -> webId vive en FamiqLink (cargado por scripts/cargar-famiq-links.ts).
 *
 * Caché en memoria de 10 minutos por producto para no castigar su servidor:
 * el stock de un proveedor no necesita más frescura que eso.
 */

import { logger } from '@/lib/logger'

const BASE = 'https://www.famiq.com.ar'
const CACHE_TTL_MS = 10 * 60 * 1000
const FETCH_TIMEOUT_MS = 12_000

export interface FamiqSucursalStock {
  nombre: string
  codigo: string
  stock: number
  /** La web avisa que hay stock en la sucursal pero no publica la cantidad */
  sinCantidad: boolean
}

export interface FamiqLiveData {
  codigo: string
  precioListaUsd: number | null
  moneda: string | null
  sucursales: FamiqSucursalStock[]
  stockTotal: number
  fetchedAt: string
}

interface RawSucursal {
  id?: number | string
  nombre?: string
  codigo?: string
  // la web manda 0 (número) o {key, valor} cuando hay stock
  stock?: number | { valor?: number | string } | null
}

interface RawProducto {
  codigo?: number | string
  precioBase?: number | null
  moneda?: unknown
  stockEnSucursales?: (number | string)[] | null
  precios?: { stockActualSucursales?: RawSucursal[] } | null
}

const cache = new Map<string, { at: number; data: FamiqLiveData }>()

function parseStock(raw: RawSucursal['stock']): number {
  if (raw == null) return 0
  if (typeof raw === 'number') return raw
  const v = Number(raw.valor ?? 0)
  return Number.isFinite(v) ? v : 0
}

const NUXT_WRAPPERS = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef'])

/**
 * Extrae el producto del __NUXT_DATA__ de la página. El formato es un arreglo
 * donde cada objeto/arreglo guarda índices a otras posiciones del mismo.
 */
export function parseFamiqProductPage(html: string): RawProducto | null {
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) return null
  let flat: unknown[]
  try {
    flat = JSON.parse(m[1])
  } catch {
    return null
  }
  if (!Array.isArray(flat)) return null

  const resolve = (i: unknown, depth: number): unknown => {
    if (typeof i !== 'number' || i < 0 || depth > 30) return null
    const v = flat[i]
    if (v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string') {
        return NUXT_WRAPPERS.has(v[0]) ? resolve(v[1], depth + 1) : null
      }
      return v.map((x) => resolve(x, depth + 1))
    }
    const out: Record<string, unknown> = {}
    for (const [k, ref] of Object.entries(v)) out[k] = resolve(ref, depth + 1)
    return out
  }

  const idx = flat.findIndex(
    (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && 'codigo' in v && 'precios' in v,
  )
  if (idx < 0) return null
  return resolve(idx, 0) as RawProducto
}

export async function getFamiqLiveData(webId: number): Promise<FamiqLiveData | null> {
  const key = String(webId)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data

  let res: Response
  try {
    // el sitio ignora el texto después del id ("-x" alcanza)
    res = await fetch(`${BASE}/producto/${webId}-x`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ERP-ValArg/1.0)',
        Accept: 'text/html',
        Referer: `${BASE}/`,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    logger.error(`[FAMIQ] fetch webId ${webId} falló`, err)
    return hit?.data ?? null // caché vencida antes que nada
  }
  if (!res.ok) {
    logger.error(`[FAMIQ] webId ${webId} -> HTTP ${res.status}`)
    return hit?.data ?? null
  }
  const prod = parseFamiqProductPage(await res.text())
  if (!prod?.precios) {
    logger.error(`[FAMIQ] webId ${webId}: la página no trae los datos esperados (¿cambió el sitio?)`)
    return hit?.data ?? null
  }

  const conStock = new Set((prod.stockEnSucursales ?? []).map(String))
  const sucursales = (prod.precios.stockActualSucursales ?? []).map((s) => {
    const stock = parseStock(s.stock)
    return {
      nombre: s.nombre ?? '?',
      codigo: s.codigo ?? '?',
      stock,
      sinCantidad: stock <= 0 && s.id != null && conStock.has(String(s.id)),
    }
  })
  const precio = Number(prod.precioBase)
  const data: FamiqLiveData = {
    codigo: String(prod.codigo ?? ''),
    // sin login la web manda 0: no es un precio
    precioListaUsd: Number.isFinite(precio) && precio > 0 ? precio : null,
    moneda: typeof prod.moneda === 'string' ? prod.moneda : null,
    sucursales,
    stockTotal: sucursales.reduce((a, s) => a + s.stock, 0),
    fetchedAt: new Date().toISOString(),
  }
  cache.set(key, { at: Date.now(), data })
  return data
}

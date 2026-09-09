/**
 * Cliente de la API pública de famiq.com.ar.
 *
 * GET https://www.famiq.com.ar/producto/{webId}/data devuelve, sin login,
 * el stock en vivo por sucursal y el precio de lista general en USD. El webId
 * es el ID interno del sitio; el mapeo código FAMIQ (= SKU del ERP) -> webId
 * vive en FamiqLink (cargado por scripts/cargar-famiq-links.ts).
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
  nombre?: string
  codigo?: string
  // la web manda 0 (número) o {key, valor} cuando hay stock
  stock?: number | { valor?: number | string } | null
}

const cache = new Map<string, { at: number; data: FamiqLiveData }>()

function parseStock(raw: RawSucursal['stock']): number {
  if (raw == null) return 0
  if (typeof raw === 'number') return raw
  const v = Number(raw.valor ?? 0)
  return Number.isFinite(v) ? v : 0
}

export async function getFamiqLiveData(webId: number): Promise<FamiqLiveData | null> {
  const key = String(webId)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data

  let res: Response
  try {
    res = await fetch(`${BASE}/producto/${webId}/data?nodo=null`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ERP-ValArg/1.0)',
        Accept: 'application/json',
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
  const j = (await res.json()) as {
    codigo?: number | string
    precios?: { PrecioBase?: number; Konwa?: string; stockActualSucursales?: RawSucursal[] }
  }
  const sucursales = (j.precios?.stockActualSucursales ?? [])
    .map((s) => ({ nombre: s.nombre ?? '?', codigo: s.codigo ?? '?', stock: parseStock(s.stock) }))
  const data: FamiqLiveData = {
    codigo: String(j.codigo ?? ''),
    precioListaUsd: j.precios?.PrecioBase ?? null,
    moneda: j.precios?.Konwa ?? null,
    sucursales,
    stockTotal: sucursales.reduce((a, s) => a + s.stock, 0),
    fetchedAt: new Date().toISOString(),
  }
  cache.set(key, { at: Date.now(), data })
  return data
}

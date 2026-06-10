/**
 * Colppy Inventory: cache compartido, carga masiva y sync hacia la tabla Product.
 *
 * Originalmente este código vivía dentro de src/app/api/colppy/inventario/route.ts.
 * Lo extrajimos a un lib para poder reusar el cache y el flujo de sync desde
 * el flujo de post-facturación (re-sync fire-and-forget) sin duplicar código
 * ni mantener dos caches en paralelo.
 *
 * El cache y la sesión Colppy son module-scoped: una sola instancia para todo
 * el proceso Node. TTLs: cache 5 min, sesión 20 min. Cualquier import de este
 * módulo desde cualquier route comparte el mismo state.
 *
 * TODO (mejora v2): proteger contra "cache stampede". Si dos llamadas
 * simultáneas encuentran el cache stale, ambas disparan loadAllInventory()
 * pegando dos veces a Colppy. Mitigación: un singleton `Promise<Map>` en
 * module scope que represente la carga in-flight; las llamadas concurrentes
 * lo awaitean en vez de iniciar otra. No urgente en práctica porque la
 * concurrencia real es baja (1-2 facturaciones por día por operador).
 */

import * as crypto from 'crypto'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { callColppyAPI, colppySleep, COLPPY_PAGE_THROTTLE_MS } from '@/lib/colppy'

// ============================================================================
// CONFIGURACIÓN
// ============================================================================

const COLPPY_USER = process.env.COLPPY_USER || ''
const COLPPY_PASSWORD = process.env.COLPPY_PASSWORD || ''
const COLPPY_ID_EMPRESA = process.env.COLPPY_ID_EMPRESA || ''

function md5(text: string): string {
  return crypto.createHash('md5').update(text).digest('hex')
}

// ============================================================================
// TIPOS
// ============================================================================

export interface InventoryItem {
  colppyItemId: number
  codigo: string
  descripcion: string
  disponibilidad: number // Stock disponible
  precioVenta: number
  costoCalculado: number
}

interface SyncResult {
  updated: number
  unchanged: number
  notFound: number
  notFoundSkus: string[]
}

interface ProductRow {
  id: string
  sku: string
  colppyItemId: number | null
  stockQuantity: number
}

// ============================================================================
// CACHE EN MEMORIA (module-scoped, compartido entre rutas)
// ============================================================================

let inventoryCache: Map<string, InventoryItem> = new Map()
let cacheTimestamp: number = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutos

let cachedSession: { claveSesion: string; timestamp: number } | null = null
const SESSION_TTL = 20 * 60 * 1000

export function invalidateInventoryCache(): void {
  cacheTimestamp = 0
  inventoryCache = new Map()
}

// ============================================================================
// COLPPY API HELPERS
// ============================================================================

// Delegado al wrapper central (maneja 429/Retry-After con reintentos).
// throwOnEstadoError=false: los callers de acá chequean result.estado a mano
// para implementar su propio retry de sesión expirada.
async function callColppy(payload: any): Promise<any> {
  return callColppyAPI<any>(payload, 30000, { throwOnEstadoError: false })
}

async function getSession(): Promise<string> {
  if (cachedSession && Date.now() - cachedSession.timestamp < SESSION_TTL) {
    return cachedSession.claveSesion
  }
  const passwordMD5 = md5(COLPPY_PASSWORD)
  const response = await callColppy({
    auth: { usuario: COLPPY_USER, password: passwordMD5 },
    service: { provision: 'Usuario', operacion: 'iniciar_sesion' },
    parameters: { usuario: COLPPY_USER, password: passwordMD5 },
  })
  if (response.result?.estado !== 0) {
    throw new Error(`Error login Colppy: ${response.result?.mensaje}`)
  }
  cachedSession = {
    claveSesion: response.response.data.claveSesion,
    timestamp: Date.now(),
  }
  return cachedSession.claveSesion
}

// ============================================================================
// CARGA MASIVA DE INVENTARIO (con cache)
// ============================================================================

/**
 * Devuelve el cache actual si está fresco; sino, recarga desde Colppy en
 * bloques de 500 (paginado) y refresca el cache.
 *
 * Logs preservados desde la versión anterior:
 *   "[Colppy Inventario] Cargando todos los items..."
 *   "[Colppy Inventario] N items cargados en Xms"
 */
export async function loadAllInventory(): Promise<Map<string, InventoryItem>> {
  if (inventoryCache.size > 0 && Date.now() - cacheTimestamp < CACHE_TTL) {
    return inventoryCache
  }

  logger.info('[Colppy Inventario] Cargando todos los items...')
  const startTime = Date.now()

  const claveSesion = await getSession()
  const passwordMD5 = md5(COLPPY_PASSWORD)

  let allItems: any[] = []
  let start = 0
  const BLOCK_SIZE = 500

  while (true) {
    const response = await callColppy({
      auth: { usuario: COLPPY_USER, password: passwordMD5 },
      service: { provision: 'Inventario', operacion: 'listar_itemsinventario' },
      parameters: {
        sesion: { usuario: COLPPY_USER, claveSesion },
        idEmpresa: COLPPY_ID_EMPRESA,
        start,
        limit: BLOCK_SIZE,
        filter: [],
        order: { field: 'codigo', order: 'asc' },
      },
    })

    if (response.result?.estado !== 0 || !response.response?.success) {
      // Si sesión expiró en la primera página, reintentar con nueva sesión
      if (start === 0) {
        cachedSession = null
        const newSession = await getSession()
        const retry = await callColppy({
          auth: { usuario: COLPPY_USER, password: md5(COLPPY_PASSWORD) },
          service: { provision: 'Inventario', operacion: 'listar_itemsinventario' },
          parameters: {
            sesion: { usuario: COLPPY_USER, claveSesion: newSession },
            idEmpresa: COLPPY_ID_EMPRESA,
            start,
            limit: BLOCK_SIZE,
            filter: [],
            order: { field: 'codigo', order: 'asc' },
          },
        })
        if (retry.result?.estado !== 0 || !retry.response?.success) {
          throw new Error(
            retry.result?.mensaje || retry.response?.message || 'Error cargando inventario'
          )
        }
        const items = retry.response.data || []
        allItems = allItems.concat(items)
        const total = parseInt(retry.response.total || '0')
        start += BLOCK_SIZE
        if (start >= total || items.length === 0) break
        // Throttle entre bloques: nos mantiene lejos del rate limit de 60 req/min
        await colppySleep(COLPPY_PAGE_THROTTLE_MS)
      } else {
        throw new Error(
          response.result?.mensaje || response.response?.message || 'Error cargando inventario'
        )
      }
    } else {
      const items = response.response.data || []
      allItems = allItems.concat(items)
      const total = parseInt(response.response.total || '0')
      start += BLOCK_SIZE
      if (start >= total || items.length === 0) break
      // Throttle entre bloques: nos mantiene lejos del rate limit de 60 req/min
      await colppySleep(COLPPY_PAGE_THROTTLE_MS)
    }
  }

  const newCache = new Map<string, InventoryItem>()
  for (const item of allItems) {
    newCache.set(item.codigo, {
      colppyItemId: parseInt(item.idItem),
      codigo: item.codigo,
      descripcion: item.descripcion || '',
      disponibilidad: parseFloat(item.disponibilidad || '0'),
      precioVenta: parseFloat(item.precioVenta || '0'),
      costoCalculado: parseFloat(item.costoCalculado || '0'),
    })
  }

  inventoryCache = newCache
  cacheTimestamp = Date.now()
  const elapsed = Date.now() - startTime
  logger.info(`[Colppy Inventario] ${newCache.size} items cargados en ${elapsed}ms`)
  return inventoryCache
}

// ============================================================================
// SYNC HACIA LA TABLA Product
// ============================================================================

/**
 * Core compartido: dado un set de productos de la DB y un cache de inventario,
 * computa qué stockQuantity hay que cambiar y los aplica en una transacción.
 */
async function applyStockSync(
  products: ProductRow[],
  inventory: Map<string, InventoryItem>
): Promise<SyncResult> {
  const colppyIdMap = new Map<number, InventoryItem>()
  for (const item of inventory.values()) {
    colppyIdMap.set(item.colppyItemId, item)
  }

  let updated = 0
  let unchanged = 0
  let notFound = 0
  const notFoundSkus: string[] = []
  const updates: Array<{ id: string; stockQuantity: number }> = []

  for (const product of products) {
    let colppyItem = inventory.get(product.sku)
    if (!colppyItem && product.colppyItemId) {
      colppyItem = colppyIdMap.get(product.colppyItemId)
    }
    if (!colppyItem) {
      notFound++
      notFoundSkus.push(product.sku)
      continue
    }
    const newStock = Math.floor(colppyItem.disponibilidad) // Int en schema
    if (product.stockQuantity !== newStock) {
      updates.push({ id: product.id, stockQuantity: newStock })
      updated++
    } else {
      unchanged++
    }
  }

  if (updates.length > 0) {
    // Usamos el callback form de $transaction para poder pasar maxWait/timeout
    // (el array form solo acepta isolationLevel). Coincide con el patrón del
    // resto del proyecto (60s timeout para tx con muchas operaciones).
    await prisma.$transaction(
      async (tx) => {
        for (const u of updates) {
          await tx.product.update({
            where: { id: u.id },
            data: { stockQuantity: u.stockQuantity },
          })
        }
      },
      { maxWait: 10000, timeout: 60000 }
    )
  }

  return { updated, unchanged, notFound, notFoundSkus }
}

/**
 * Flujo del botón "Actualizar Stock" (POST /api/colppy/inventario):
 * invalida el cache, recarga TODO el inventario y sincroniza TODA la tabla
 * products. Preserva los logs y contadores del endpoint original.
 */
export async function refreshCacheAndSyncAllProducts(): Promise<{
  total: number
  stockSync: SyncResult & { totalProducts: number }
}> {
  invalidateInventoryCache()
  const inventory = await loadAllInventory()

  const products = await prisma.product.findMany({
    select: { id: true, sku: true, colppyItemId: true, stockQuantity: true },
  })

  const result = await applyStockSync(products, inventory)

  logger.info(
    `[Colppy Inventario] Stock persistido: ${result.updated} actualizados, ${result.unchanged} sin cambios, ${result.notFound} sin match`
  )

  return {
    total: inventory.size,
    stockSync: { ...result, totalProducts: products.length },
  }
}

/**
 * Flujo post-facturación: usa el cache vigente (NO lo invalida) y
 * sincroniza solo los productos cuyos SKUs vinieron como argumento.
 *
 * notFound combina dos casos: (a) SKU sin Product en DB; (b) Product existe
 * pero el código no figura en el inventario actual de Colppy.
 */
export async function syncStockForSkus(skus: string[]): Promise<SyncResult> {
  if (skus.length === 0) {
    return { updated: 0, unchanged: 0, notFound: 0, notFoundSkus: [] }
  }

  const inventory = await loadAllInventory()

  const products = await prisma.product.findMany({
    where: { sku: { in: skus } },
    select: { id: true, sku: true, colppyItemId: true, stockQuantity: true },
  })

  // SKUs pedidos que no tienen Product en DB
  const foundSkuSet = new Set(products.map((p) => p.sku))
  const skusWithoutProduct = skus.filter((s) => !foundSkuSet.has(s))

  const result = await applyStockSync(products, inventory)

  return {
    updated: result.updated,
    unchanged: result.unchanged,
    notFound: result.notFound + skusWithoutProduct.length,
    notFoundSkus: [...result.notFoundSkus, ...skusWithoutProduct],
  }
}

/**
 * Wrapper fire-and-forget para post-facturación.
 *
 * Patrón idéntico a logAudit (src/lib/audit.ts): función synchronous (void),
 * promesa interna con .catch que loguea. El llamador NO necesita await.
 *
 * Llamar después de un commit de DB exitoso, antes del return al cliente.
 *
 * Lección del bug del 27-may: este wrapper SIEMPRE loguea. Un fire-and-forget
 * que falla en silencio es peligroso. Los 3 niveles son:
 *   - inicio (info): qué se va a sincronizar.
 *   - éxito sin SKUs sin match (info).
 *   - éxito CON SKUs sin match (warn): probablemente producto sin vincular
 *     o SKU mal escrito; merece atención.
 *   - fallo (error): incluye stack completo.
 */
export function syncStockForSkusFireAndForget(
  skus: string[],
  context: { quoteId?: string; quoteNumber: string; action: string }
): void {
  const cleanSkus = Array.from(
    new Set(skus.filter((s) => typeof s === 'string' && s.trim().length > 0))
  )
  if (cleanSkus.length === 0) return

  logger.info(
    `[STOCK_SYNC_POST_BILLING] inicio — quote=${context.quoteNumber} action=${context.action} skus=[${cleanSkus.join(',')}]`
  )

  syncStockForSkus(cleanSkus)
    .then((r) => {
      if (r.notFound > 0) {
        logger.warn(
          `[STOCK_SYNC_POST_BILLING] OK con SKUs sin match — quote=${context.quoteNumber} updated=${r.updated} unchanged=${r.unchanged} notFound=${r.notFound} notFoundSkus=[${r.notFoundSkus.join(',')}]`
        )
      } else {
        logger.info(
          `[STOCK_SYNC_POST_BILLING] OK — quote=${context.quoteNumber} updated=${r.updated} unchanged=${r.unchanged} notFound=0`
        )
      }
    })
    .catch((err: any) => {
      logger.error(`[STOCK_SYNC_POST_BILLING] fallo — quote=${context.quoteNumber}`, {
        error: err?.message,
        stack: err?.stack,
      })
    })
}

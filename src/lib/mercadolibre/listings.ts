/**
 * Publicaciones de Mercado Libre <-> productos del ERP, y sync de stock.
 *
 * importListings():
 *   Trae todas las publicaciones activas y pausadas del seller, las upsertea
 *   en MlItemLink y trata de matchearlas con un Product:
 *     1. por seller_custom_field (SKU cargado en ML) == Product.sku
 *     2. por código Genebre en el título ("2109-11", "3190 04" -> "2109 11")
 *   Solo toca el vínculo de las filas UNMATCHED; las LINKED/IGNORED se respetan.
 *
 * syncStockToMl():
 *   1. Colppy -> ERP: refresca stockQuantity de los SKUs vinculados
 *      (syncStockForSkus; Colppy es la fuente de verdad).
 *   2. ERP -> ML: para cada vínculo LINKED con syncEnabled calcula
 *      target = clamp(stock - safetyStock, 0, maxPublish) y hace PUT
 *      available_quantity solo si difiere de lo publicado.
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { MlLinkStatus } from '@prisma/client'
import { syncStockForSkus } from '@/lib/colppy-inventory'
import { searchMyItemIds, getItemsLite, updateItem, MlApiError, type MlItemLite } from './client'

// Códigos Genebre en el título: "2109-11", "2109 11", "2034c 04", "2459a 10",
// "2835ae 12", "70037 05", "3822 010" -> "2109 11", "2034C 04", ... (formato de
// Product.sku). Las variantes con cero inicial se prueban también sin el cero.
const GENEBRE_RE = /\b(\d{4,5}[a-z]{0,2})[\s\-.]?(\d{2,3})\b/gi
// Modelos alfanuméricos (Winters, Danfoss, CENI...): "LE3150", "TBM20040B36S",
// "PPC5065", "KPI35", "PLP302R12R99VAC". Se matchean exactos o por prefijo único.
const MODEL_RE = /\b([A-Z]{2,4}\d{3,}[A-Z0-9+\-]*)\b/gi

export function extractCodesFromTitle(title: string): string[] {
  const out = new Set<string>()
  for (const m of title.matchAll(GENEBRE_RE)) {
    const fam = m[1].toUpperCase()
    const v = m[2]
    out.add(`${fam} ${v}`)
    if (v.length === 3 && v.startsWith('0')) out.add(`${fam} ${v.slice(1)}`)
  }
  return [...out]
}

export function extractModelsFromTitle(title: string): string[] {
  const out = new Set<string>()
  for (const m of title.matchAll(MODEL_RE)) out.add(m[1].toUpperCase())
  return [...out]
}

function resolveSku(item: MlItemLite): string | null {
  if (item.seller_custom_field?.trim()) return item.seller_custom_field.trim()
  const v = (item.variations ?? []).find((x) => x.seller_custom_field?.trim())
  return v?.seller_custom_field?.trim() ?? null
}

export interface ImportResult {
  total: number
  linked: number
  unmatched: number
  newLinks: number
}

export async function importListings(): Promise<ImportResult> {
  const [active, paused] = await Promise.all([searchMyItemIds('active'), searchMyItemIds('paused')])
  const ids = [...new Set([...active, ...paused])]
  const items = await getItemsLite(ids)
  logger.info(`[ML Listings] ${items.length} publicaciones (${active.length} activas, ${paused.length} pausadas)`)

  // Candidatos de SKU/modelo de todos los ítems en pocas queries.
  const skuCandidates = new Set<string>()
  const modelCandidates = new Set<string>()
  for (const it of items) {
    const sku = resolveSku(it)
    if (sku) skuCandidates.add(sku)
    for (const c of extractCodesFromTitle(it.title)) skuCandidates.add(c)
    for (const m of extractModelsFromTitle(it.title)) modelCandidates.add(m)
  }
  const products = await prisma.product.findMany({
    where: { sku: { in: [...skuCandidates], mode: 'insensitive' } },
    select: { id: true, sku: true },
  })
  const bySku = new Map(products.map((p) => [p.sku.toUpperCase(), p.id]))

  // Modelos: exacto o prefijo. Si un prefijo matchea varios productos, es ambiguo.
  const modelList = [...modelCandidates]
  const modelProducts = modelList.length
    ? await prisma.product.findMany({
        where: { OR: modelList.map((m) => ({ sku: { startsWith: m, mode: 'insensitive' } })) },
        select: { id: true, sku: true },
      })
    : []
  const byModel = new Map<string, string[]>()
  for (const m of modelList) {
    const exact = modelProducts.filter((p) => p.sku.toUpperCase() === m)
    const pref = exact.length ? exact : modelProducts.filter((p) => p.sku.toUpperCase().startsWith(m))
    byModel.set(m, [...new Set(pref.map((p) => p.id))])
  }

  const existing = await prisma.mlItemLink.findMany({
    where: { mlItemId: { in: ids } },
    select: { mlItemId: true, status: true },
  })
  const existingStatus = new Map(existing.map((e) => [e.mlItemId, e.status]))

  let linked = 0
  let newLinks = 0
  const upsertOne = async (it: MlItemLite) => {
    const sku = resolveSku(it)
    const base = {
      title: it.title,
      permalink: it.permalink ?? null,
      mlStatus: it.status ?? null,
      mlSku: sku,
      mlQuantity: it.available_quantity ?? null,
      price: it.price ?? null,
    }

    // Matcheo automático solo si no está ya decidido (LINKED/IGNORED).
    const prev = existingStatus.get(it.id)
    let match: { productId: string; method: string } | null = null
    if (!prev || prev === MlLinkStatus.UNMATCHED) {
      const skuU = sku?.toUpperCase()
      if (skuU && bySku.has(skuU)) match = { productId: bySku.get(skuU)!, method: 'sku' }
      else {
        const hits = [...new Set(extractCodesFromTitle(it.title).filter((c) => bySku.has(c)).map((c) => bySku.get(c)!))]
        if (hits.length === 1) match = { productId: hits[0], method: 'title-code' }
        else if (hits.length === 0) {
          const mh = [...new Set(extractModelsFromTitle(it.title).flatMap((m) => byModel.get(m) ?? []))]
          if (mh.length === 1) match = { productId: mh[0], method: 'title-model' }
        }
      }
    }

    const matchData = match
      ? { productId: match.productId, status: MlLinkStatus.LINKED, matchMethod: match.method }
      : {}

    await prisma.mlItemLink.upsert({
      where: { mlItemId: it.id },
      create: { mlItemId: it.id, ...base, ...matchData },
      update: { ...base, ...matchData },
    })
    if (!prev) newLinks++
    if (match || prev === MlLinkStatus.LINKED) linked++
  }

  // Upserts en lotes paralelos: la DB es remota y de a uno tarda minutos.
  const BATCH = 25
  for (let i = 0; i < items.length; i += BATCH) {
    await Promise.all(items.slice(i, i + BATCH).map(upsertOne))
  }

  // Publicaciones que ya no existen en ML (cerradas): marcarlas.
  await prisma.mlItemLink.updateMany({
    where: { mlItemId: { notIn: ids }, mlStatus: { not: 'closed' } },
    data: { mlStatus: 'closed' },
  })

  const unmatched = await prisma.mlItemLink.count({ where: { status: MlLinkStatus.UNMATCHED } })
  return { total: items.length, linked, unmatched, newLinks }
}

/** Escribe el SKU del ERP en la publicación (seller_custom_field). Best-effort. */
export async function pushSkuToMl(mlItemId: string, sku: string): Promise<boolean> {
  try {
    await updateItem(mlItemId, { seller_custom_field: sku })
    await prisma.mlItemLink.update({ where: { mlItemId }, data: { mlSku: sku } })
    return true
  } catch (err) {
    const detail = err instanceof MlApiError ? JSON.stringify(err.body) : String(err)
    logger.warn(`[ML Listings] No se pudo escribir SKU en ${mlItemId}: ${detail}`)
    return false
  }
}

export function computeTarget(stock: number, safetyStock: number, maxPublish: number | null): number {
  let t = Math.max(0, stock - Math.max(0, safetyStock))
  if (maxPublish != null && maxPublish >= 0) t = Math.min(t, maxPublish)
  return t
}

export interface StockSyncResult {
  colppy: { updated: number; unchanged: number; notFound: number }
  checked: number
  updated: number
  unchanged: number
  errors: number
  changes: { mlItemId: string; title: string; from: number | null; to: number }[]
}

export async function syncStockToMl(opts: { linkIds?: string[]; skipColppy?: boolean } = {}): Promise<StockSyncResult> {
  const links = await prisma.mlItemLink.findMany({
    where: {
      status: MlLinkStatus.LINKED,
      syncEnabled: true,
      productId: { not: null },
      ...(opts.linkIds ? { id: { in: opts.linkIds } } : {}),
    },
    include: { product: { select: { sku: true, stockQuantity: true } } },
  })

  // 1. Colppy -> ERP
  let colppy = { updated: 0, unchanged: 0, notFound: 0 }
  if (!opts.skipColppy && links.length) {
    try {
      const r = await syncStockForSkus([...new Set(links.map((l) => l.product!.sku))])
      colppy = { updated: r.updated, unchanged: r.unchanged, notFound: r.notFound }
    } catch (err) {
      logger.error('[ML Stock] Falló el sync Colppy -> ERP; sigo con el stock actual del ERP', err)
    }
  }

  // Releer stock ya actualizado y la cantidad real publicada en ML.
  const fresh = await prisma.mlItemLink.findMany({
    where: { id: { in: links.map((l) => l.id) } },
    include: { product: { select: { sku: true, stockQuantity: true } } },
  })
  const live = new Map((await getItemsLite(fresh.map((l) => l.mlItemId))).map((i) => [i.id, i]))

  const result: StockSyncResult = { colppy, checked: fresh.length, updated: 0, unchanged: 0, errors: 0, changes: [] }

  for (const link of fresh) {
    const item = live.get(link.mlItemId)
    if (!item || item.status === 'closed') {
      result.unchanged++
      continue
    }
    const target = computeTarget(link.product!.stockQuantity, link.safetyStock, link.maxPublish)
    const current = item.available_quantity ?? null

    if (current === target) {
      result.unchanged++
      await prisma.mlItemLink.update({
        where: { id: link.id },
        data: { mlQuantity: current, mlStatus: item.status ?? null, lastSyncAt: new Date(), lastSyncQty: target, lastSyncError: null },
      })
      continue
    }

    try {
      const body: Record<string, unknown> = { available_quantity: target }
      // Si estaba pausada por falta de stock y ahora hay, reactivar.
      if (item.status === 'paused' && target > 0) body.status = 'active'
      const updated = await updateItem(link.mlItemId, body)
      result.updated++
      result.changes.push({ mlItemId: link.mlItemId, title: link.title, from: current, to: target })
      await prisma.mlItemLink.update({
        where: { id: link.id },
        data: { mlQuantity: target, mlStatus: updated.status ?? item.status ?? null, lastSyncAt: new Date(), lastSyncQty: target, lastSyncError: null },
      })
    } catch (err) {
      result.errors++
      const detail = err instanceof MlApiError ? JSON.stringify(err.body) : String(err)
      logger.error(`[ML Stock] Error actualizando ${link.mlItemId} -> ${target}`, detail)
      await prisma.mlItemLink.update({
        where: { id: link.id },
        data: { lastSyncAt: new Date(), lastSyncError: detail.slice(0, 500) },
      })
    }
  }

  logger.info(
    `[ML Stock] checked=${result.checked} updated=${result.updated} unchanged=${result.unchanged} errors=${result.errors} (colppy: ${colppy.updated} act.)`
  )
  return result
}

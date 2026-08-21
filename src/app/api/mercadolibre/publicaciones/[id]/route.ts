/**
 * PATCH /api/mercadolibre/publicaciones/[id]
 *   Body: { productId?: string | null, syncEnabled?: boolean, safetyStock?: number,
 *           maxPublish?: number | null, ignore?: boolean, pushSku?: boolean }
 *   - productId: vincula (LINKED, matchMethod manual) o desvincula (null -> UNMATCHED).
 *     Al vincular, por defecto escribe el SKU del ERP en la publicación de ML.
 *   - ignore: true -> IGNORED; false -> vuelve a UNMATCHED/LINKED según tenga producto.
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { MlLinkStatus, type Prisma } from '@prisma/client'
import { pushSkuToMl } from '@/lib/mercadolibre/listings'

interface Body {
  productId?: string | null
  syncEnabled?: boolean
  safetyStock?: number
  maxPublish?: number | null
  ignore?: boolean
  pushSku?: boolean
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { id } = await params
    const body = (await req.json()) as Body
    const link = await prisma.mlItemLink.findUnique({ where: { id } })
    if (!link) return NextResponse.json({ error: 'Publicación no encontrada' }, { status: 404 })

    const data: Prisma.MlItemLinkUncheckedUpdateInput = {}
    let skuToPush: string | null = null

    if (body.productId !== undefined) {
      if (body.productId) {
        const product = await prisma.product.findUnique({
          where: { id: body.productId },
          select: { id: true, sku: true },
        })
        if (!product) return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 })
        data.productId = product.id
        data.status = MlLinkStatus.LINKED
        data.matchMethod = 'manual'
        if (body.pushSku !== false) skuToPush = product.sku
      } else {
        data.productId = null
        data.status = MlLinkStatus.UNMATCHED
        data.matchMethod = null
      }
    }
    if (body.ignore !== undefined) {
      data.status = body.ignore
        ? MlLinkStatus.IGNORED
        : (data.productId ?? link.productId)
          ? MlLinkStatus.LINKED
          : MlLinkStatus.UNMATCHED
    }
    if (body.syncEnabled !== undefined) data.syncEnabled = Boolean(body.syncEnabled)
    if (body.safetyStock !== undefined) data.safetyStock = Math.max(0, Math.floor(Number(body.safetyStock) || 0))
    if (body.maxPublish !== undefined) {
      data.maxPublish =
        body.maxPublish === null || body.maxPublish === ('' as unknown)
          ? null
          : Math.max(0, Math.floor(Number(body.maxPublish)))
    }

    const updated = await prisma.mlItemLink.update({
      where: { id },
      data,
      include: { product: { select: { id: true, sku: true, name: true, stockQuantity: true } } },
    })

    let skuPushed: boolean | null = null
    if (skuToPush) skuPushed = await pushSkuToMl(updated.mlItemId, skuToPush)

    return NextResponse.json({
      ...updated,
      price: updated.price ? Number(updated.price) : null,
      lastSyncAt: updated.lastSyncAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      mlSku: skuPushed ? skuToPush : updated.mlSku,
      skuPushed,
    })
  } catch (error) {
    logger.error('[ML Listings] Error en PATCH', error)
    return NextResponse.json({ error: 'Error al actualizar la publicación' }, { status: 500 })
  }
}

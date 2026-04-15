import { logger } from '@/lib/logger'
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

/**
 * PATCH /api/quotes/items/[itemId]
 * Editar item de cotización
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { itemId } = await params
    const body = await request.json()

    logger.info('📝 Editando item:', itemId, body)

    // Verificar que el item existe
    const existingItem = await prisma.quoteItem.findUnique({
      where: { id: itemId },
      include: {
        quote: {
          include: {
            customer: true,
          },
        },
        product: true,
      },
    })

    if (!existingItem) {
      return NextResponse.json({ error: 'Item no encontrado' }, { status: 404 })
    }

    const quoteId = existingItem.quoteId

    const isManualItem = !existingItem.productId || body.isManual

    let updatedItem

    // Resolver multiplierOverride: si viene en body, usarlo; si no, mantener el existente
    const multiplierOverride = body.multiplierOverride !== undefined
      ? (body.multiplierOverride === null || body.multiplierOverride === '' ? null : Number(body.multiplierOverride))
      : (existingItem.multiplierOverride !== null ? Number(existingItem.multiplierOverride) : null)

    if (isManualItem) {
      // ── ITEM MANUAL: aplicar multiplicador del cliente ──
      const manualPrice = body.manualUnitPrice !== undefined
        ? Number(body.manualUnitPrice)
        : Number(existingItem.listPrice)
      const customerMultiplier = multiplierOverride ?? (Number(existingItem.quote.multiplier) || 1)
      // Mantener estado IVA-incluido de la cotización al recalcular el item.
      const ivaFactor = existingItem.quote.pricesIncludeTax ? 1.21 : 1
      const unitPrice = manualPrice * customerMultiplier * ivaFactor
      const quantity = body.quantity !== undefined ? body.quantity : existingItem.quantity

      updatedItem = await prisma.quoteItem.update({
        where: { id: itemId },
        data: {
          ...(existingItem.productId ? { product: { disconnect: true } } : {}),
          manualSku: body.manualSku !== undefined ? body.manualSku : existingItem.manualSku,
          manualBrand: body.manualBrand !== undefined ? body.manualBrand : existingItem.manualBrand,
          description: body.description !== undefined ? body.description : existingItem.description,
          quantity,
          listPrice: manualPrice,
          brandDiscount: 0,
          customerMultiplier,
          multiplierOverride,
          unitPrice,
          totalPrice: unitPrice * quantity,
          deliveryTime: body.deliveryTime !== undefined ? body.deliveryTime : existingItem.deliveryTime,
        },
        include: {
          product: true,
          additionals: { include: { product: true } },
        },
      })
    } else {
      // ── ITEM DE CATÁLOGO ──
      let product = existingItem.product
      if (body.productId && body.productId !== existingItem.productId) {
        const newProduct = await prisma.product.findUnique({
          where: { id: body.productId },
        })
        if (!newProduct) {
          return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 })
        }
        product = newProduct
      }

      // Obtener descuento de marca: override del vendedor o lookup automático
      let brandDiscount = 0
      if (body.brandDiscount !== undefined && body.brandDiscount !== null) {
        // Override del vendedor (viene como decimal, ej: 0.40 = 40%)
        brandDiscount = Math.max(0, Math.min(1, Number(body.brandDiscount)))
      } else if (product?.brand) {
        const brandDiscountData = await prisma.brandDiscount.findFirst({
          where: { brand: product.brand },
        })
        if (brandDiscountData) {
          brandDiscount = Number(brandDiscountData.discountPercent) / 100
        }
      }

      const listPrice = Number(product?.listPriceUSD || 0)
      let additionalsPrices = 0

      if (body.additionals && body.additionals.length > 0) {
        for (const add of body.additionals) {
          if (add.productId) {
            const addProduct = await prisma.product.findUnique({
              where: { id: add.productId },
            })
            if (addProduct && addProduct.listPriceUSD) {
              additionalsPrices += Number(addProduct.listPriceUSD)
            }
          } else {
            // Adicional manual: usar listPrice del request
            additionalsPrices += Number(add.listPrice || 0)
          }
        }
      }

      const subtotalWithAdditionals = listPrice + additionalsPrices
      const afterDiscount = subtotalWithAdditionals * (1 - brandDiscount)
      const customerMultiplier = multiplierOverride ?? Number(existingItem.quote.multiplier)
      const catIvaFactor = existingItem.quote.pricesIncludeTax ? 1.21 : 1
      const unitPrice = afterDiscount * customerMultiplier * catIvaFactor
      const quantity = body.quantity !== undefined ? body.quantity : existingItem.quantity
      const totalPrice = unitPrice * quantity

      const resolvedProductId = body.productId || existingItem.productId
      updatedItem = await prisma.quoteItem.update({
        where: { id: itemId },
        data: {
          ...(resolvedProductId ? { product: { connect: { id: resolvedProductId } } } : {}),
          description: body.description !== undefined ? body.description : existingItem.description,
          quantity,
          listPrice,
          brandDiscount,
          customerMultiplier,
          multiplierOverride,
          unitPrice,
          totalPrice,
          deliveryTime: body.deliveryTime !== undefined ? body.deliveryTime : existingItem.deliveryTime,
          ...(body.additionals && {
            additionals: {
              deleteMany: {},
              create: body.additionals.map((add: { productId?: string | null; description?: string; listPrice: number }, index: number) => ({
                productId: add.productId || null,
                description: add.description || null,
                position: index + 1,
                listPrice: add.listPrice,
              })),
            },
          }),
        },
        include: {
          product: true,
          additionals: { include: { product: true } },
        },
      })
    }

    // Recalcular totales
    await recalculateQuoteTotals(quoteId)

    logger.info('✅ Item actualizado:', updatedItem.id)

    return NextResponse.json(updatedItem)
  } catch (error) {
    logger.error('❌ Error al editar item:', error)
    return NextResponse.json(
      {
        error: 'Error al editar item',
        message: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/quotes/items/[itemId]
 * Eliminar item de cotización
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { itemId } = await params

    const item = await prisma.quoteItem.findUnique({
      where: { id: itemId },
    })

    if (!item) {
      return NextResponse.json({ error: 'Item no encontrado' }, { status: 404 })
    }

    const quoteId = item.quoteId

    // Eliminar item (cascade eliminará additionals automáticamente)
    await prisma.quoteItem.delete({
      where: { id: itemId },
    })

    // Renumerar items restantes secuencialmente (10, 20, 30...)
    await renumberQuoteItems(quoteId)

    // Recalcular totales
    await recalculateQuoteTotals(quoteId)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting item:', error)
    return NextResponse.json(
      { error: 'Error al eliminar item' },
      { status: 500 }
    )
  }
}

/**
 * Renumera los items de la cotización secuencialmente (10, 20, 30...)
 * Los items alternativos toman el mismo número que su item principal.
 */
async function renumberQuoteItems(quoteId: string) {
  // Obtener items principales ordenados por itemNumber actual
  const mainItems = await prisma.quoteItem.findMany({
    where: { quoteId, isAlternative: false },
    orderBy: { itemNumber: 'asc' },
    select: { id: true, itemNumber: true },
  })

  // Renumerar items principales: 10, 20, 30...
  const updates: Promise<unknown>[] = []
  for (let i = 0; i < mainItems.length; i++) {
    const newNumber = (i + 1) * 10
    if (mainItems[i].itemNumber !== newNumber) {
      // Actualizar el item principal
      updates.push(
        prisma.quoteItem.update({
          where: { id: mainItems[i].id },
          data: { itemNumber: newNumber },
        })
      )
      // Actualizar sus alternativas al mismo número
      updates.push(
        prisma.quoteItem.updateMany({
          where: {
            quoteId,
            isAlternative: true,
            alternativeToItemId: mainItems[i].id,
          },
          data: { itemNumber: newNumber },
        })
      )
    }
  }

  if (updates.length > 0) {
    await Promise.all(updates)
  }
}

/**
 * Recalcula los totales de la cotización
 */
async function recalculateQuoteTotals(quoteId: string) {
  const items = await prisma.quoteItem.findMany({
    where: {
      quoteId,
      isAlternative: false,
    },
  })

  const subtotal = items.reduce((sum, item) => sum + Number(item.totalPrice), 0)

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { bonification: true },
  })
  const bonif = Number(quote?.bonification) || 0
  const total = subtotal * (1 - bonif / 100)

  await prisma.quote.update({
    where: { id: quoteId },
    data: {
      subtotal,
      total,
    },
  })
}

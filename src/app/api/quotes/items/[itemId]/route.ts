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

    console.log('📝 Editando item:', itemId, body)

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

    // Si se cambió el producto, obtener el nuevo
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

    // Obtener descuento de marca
    let brandDiscount = 0
    if (product.brand) {
      const brandDiscountData = await prisma.brandDiscount.findFirst({
        where: { brand: product.brand },
      })
      if (brandDiscountData) {
        brandDiscount = Number(brandDiscountData.discountPercent) / 100
      }
    }

    // Calcular precios
    const listPrice = Number(product.listPriceUSD || 0)
    let additionalsPrices = 0

    // Sumar precios de adicionales si existen
    if (body.additionals && body.additionals.length > 0) {
      for (const add of body.additionals) {
        const addProduct = await prisma.product.findUnique({
          where: { id: add.productId },
        })
        if (addProduct && addProduct.listPriceUSD) {
          additionalsPrices += Number(addProduct.listPriceUSD)
        }
      }
    }

    const subtotalWithAdditionals = listPrice + additionalsPrices
    const afterDiscount = subtotalWithAdditionals * (1 - brandDiscount)
    // Usar multiplicador de la cotización (no del cliente)
    const customerMultiplier = Number(existingItem.quote.multiplier)
    const unitPrice = afterDiscount * customerMultiplier
    const quantity = body.quantity !== undefined ? body.quantity : existingItem.quantity
    const totalPrice = unitPrice * quantity

    // Actualizar item
    const updatedItem = await prisma.quoteItem.update({
      where: { id: itemId },
      data: {
        productId: body.productId || existingItem.productId,
        description: body.description !== undefined ? body.description : existingItem.description,
        quantity,
        listPrice,
        brandDiscount,
        customerMultiplier,
        unitPrice,
        totalPrice,
        deliveryTime: body.deliveryTime !== undefined ? body.deliveryTime : existingItem.deliveryTime,
        // Actualizar adicionales si se proporcionaron
        ...(body.additionals && {
          additionals: {
            deleteMany: {}, // Eliminar adicionales existentes
            create: body.additionals.map((add: { productId: string; listPrice: number }, index: number) => ({
              productId: add.productId,
              position: index + 1,
              listPrice: add.listPrice,
            })),
          },
        }),
      },
      include: {
        product: true,
        additionals: {
          include: {
            product: true,
          },
        },
      },
    })

    // Recalcular totales
    await recalculateQuoteTotals(quoteId)

    console.log('✅ Item actualizado:', updatedItem.id)

    return NextResponse.json(updatedItem)
  } catch (error) {
    console.error('❌ Error al editar item:', error)
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

    // Recalcular totales
    await recalculateQuoteTotals(quoteId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting item:', error)
    return NextResponse.json(
      { error: 'Error al eliminar item' },
      { status: 500 }
    )
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

  const total = items.reduce((sum, item) => sum + Number(item.totalPrice), 0)

  await prisma.quote.update({
    where: { id: quoteId },
    data: {
      subtotal: total,
      total: total,
    },
  })
}

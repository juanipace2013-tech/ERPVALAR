import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

/**
 * POST /api/quotes/[id]/items
 * Agregar item a cotización (catálogo o manual)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id: quoteId } = await params
    const body = await request.json()

    console.log('📥 Agregando item a cotización:', quoteId, body)

    // Verificar que la cotización existe
    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        customer: true,
        items: true,
      },
    })

    if (!quote) {
      return NextResponse.json(
        { error: 'Cotización no encontrada' },
        { status: 404 }
      )
    }

    // Determinar itemNumber
    let itemNumber = 10
    if (body.isAlternative && body.alternativeToItemId) {
      const parentItem = quote.items.find(
        (i) => i.id === body.alternativeToItemId
      )
      if (parentItem) {
        itemNumber = parentItem.itemNumber
      }
    } else {
      const maxItem = quote.items
        .filter((i) => !i.isAlternative)
        .sort((a, b) => b.itemNumber - a.itemNumber)[0]
      if (maxItem) {
        itemNumber = maxItem.itemNumber + 10
      }
    }

    // ── ITEM MANUAL (sin producto del catálogo) ──
    if (!body.productId) {
      if (!body.description) {
        return NextResponse.json(
          { error: 'La descripción es obligatoria para items manuales' },
          { status: 400 }
        )
      }
      const manualPrice = Number(body.manualUnitPrice) || 0
      const quantity = body.quantity || 1
      const customerMultiplier = Number(quote.multiplier) || 1
      const manualUnitPrice = manualPrice * customerMultiplier

      const manualData: any = {
        quote: { connect: { id: quoteId } },
        itemNumber,
        manualSku: body.manualSku || null,
        manualBrand: body.manualBrand || null,
        description: body.description,
        quantity,
        listPrice: manualPrice,
        brandDiscount: 0,
        customerMultiplier,
        unitPrice: manualUnitPrice,
        totalPrice: manualUnitPrice * quantity,
        deliveryTime: body.deliveryTime || 'A confirmar',
        isAlternative: body.isAlternative || false,
      }
      if (body.alternativeToItemId) {
        manualData.alternativeToItemId = body.alternativeToItemId
      }

      const item = await prisma.quoteItem.create({
        data: manualData,
        include: {
          product: true,
          additionals: { include: { product: true } },
        },
      })

      await recalculateQuoteTotals(quoteId)
      console.log('✅ Item manual agregado:', item.id)
      return NextResponse.json(item, { status: 201 })
    }

    // ── ITEM DE CATÁLOGO ──
    const product = await prisma.product.findUnique({
      where: { id: body.productId },
      include: { category: true },
    })

    if (!product) {
      return NextResponse.json(
        { error: 'Producto no encontrado' },
        { status: 404 }
      )
    }

    // Obtener descuento de marca
    // Si el cliente envió un override, usarlo. Si no, lookup automático.
    let brandDiscount = 0
    if (body.brandDiscount !== undefined && body.brandDiscount !== null) {
      // Override del vendedor (viene como decimal, ej: 0.40 = 40%)
      brandDiscount = Math.max(0, Math.min(1, Number(body.brandDiscount)))
    } else if (product.brand) {
      // Prioridad: 1) match exacto brand+productType, 2) match genérico brand
      let brandDiscountData = await prisma.brandDiscount.findUnique({
        where: {
          brand_productType: {
            brand: product.brand,
            productType: product.category?.name || ''
          }
        }
      })
      if (!brandDiscountData) {
        brandDiscountData = await prisma.brandDiscount.findFirst({
          where: { brand: product.brand }
        })
      }
      if (brandDiscountData) {
        brandDiscount = Number(brandDiscountData.discountPercent) / 100
      }
    }

    const listPrice = Number(product.listPriceUSD || 0)
    let additionalsPrices = 0

    if (body.additionals && body.additionals.length > 0) {
      for (const add of body.additionals) {
        if (add.productId) {
          // Adicional de catálogo: buscar precio del producto
          const addProduct = await prisma.product.findUnique({
            where: { id: add.productId },
          })
          if (addProduct && addProduct.listPriceUSD) {
            additionalsPrices += Number(addProduct.listPriceUSD)
          }
        } else {
          // Adicional manual: usar listPrice del request directo
          additionalsPrices += Number(add.listPrice || 0)
        }
      }
    }

    const subtotalWithAdditionals = listPrice + additionalsPrices
    const afterDiscount = subtotalWithAdditionals * (1 - brandDiscount)
    const customerMultiplier = Number(quote.multiplier)
    const unitPrice = afterDiscount * customerMultiplier
    const quantity = body.quantity || 1
    const totalPrice = unitPrice * quantity

    const item = await prisma.quoteItem.create({
      data: {
        quoteId,
        itemNumber,
        productId: body.productId,
        description: body.description,
        quantity,
        listPrice,
        brandDiscount,
        customerMultiplier,
        unitPrice,
        totalPrice,
        deliveryTime: body.deliveryTime || 'Inmediato',
        isAlternative: body.isAlternative || false,
        alternativeToItemId: body.alternativeToItemId,
        additionals: body.additionals
          ? {
              create: body.additionals.map((add: { productId?: string | null; description?: string; listPrice: number }, index: number) => ({
                productId: add.productId || null,
                description: add.description || null,
                position: index + 1,
                listPrice: add.listPrice,
              })),
            }
          : undefined,
      },
      include: {
        product: true,
        additionals: {
          include: { product: true },
        },
      },
    })

    await recalculateQuoteTotals(quoteId)

    console.log('✅ Item agregado:', item.id)

    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    console.error('❌ Error al agregar item:', error)
    return NextResponse.json(
      {
        error: 'Error al agregar item',
        message: error instanceof Error ? error.message : 'Error desconocido',
      },
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

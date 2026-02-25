import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

/**
 * POST /api/quotes/[id]/items
 * Agregar item a cotización
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

    // Obtener producto con categoría
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
    let brandDiscount = 0
    if (product.brand) {
      // 1. Buscar por brand + productType exacto
      let brandDiscountData = await prisma.brandDiscount.findUnique({
        where: {
          brand_productType: {
            brand: product.brand,
            productType: product.category?.name || ''
          }
        }
      })
      // 2. Si no encuentra, buscar solo por brand (productType null)
      if (!brandDiscountData) {
        brandDiscountData = await prisma.brandDiscount.findFirst({
          where: { brand: product.brand, productType: null }
        })
      }
      if (brandDiscountData) {
        brandDiscount = Number(brandDiscountData.discountPercent) / 100
      }
    }

    // Calcular precios según fórmula VAL ARG:
    // Precio Final = (Precio Lista + Sum(Adicionales)) × (1 - Descuento Marca) × Multiplicador Cliente

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
    const customerMultiplier = Number(quote.customer.priceMultiplier)
    const unitPrice = afterDiscount * customerMultiplier
    const quantity = body.quantity || 1
    const totalPrice = unitPrice * quantity

    // Determinar itemNumber
    let itemNumber = 10
    if (body.isAlternative && body.alternativeToItemId) {
      // Es alternativa, usar el mismo número base
      const parentItem = quote.items.find(
        (i) => i.id === body.alternativeToItemId
      )
      if (parentItem) {
        itemNumber = parentItem.itemNumber
      }
    } else {
      // Es item principal, buscar el mayor número y sumar 10
      const maxItem = quote.items
        .filter((i) => !i.isAlternative)
        .sort((a, b) => b.itemNumber - a.itemNumber)[0]
      if (maxItem) {
        itemNumber = maxItem.itemNumber + 10
      }
    }

    // Crear item
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
              create: body.additionals.map((add: { productId: string; listPrice: number }, index: number) => ({
                productId: add.productId,
                position: index + 1,
                listPrice: add.listPrice,
              })),
            }
          : undefined,
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

    // Recalcular totales de la cotización
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
      isAlternative: false, // Solo items principales, no alternativas
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

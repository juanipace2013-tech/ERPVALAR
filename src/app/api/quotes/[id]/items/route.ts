import { logger } from '@/lib/logger'
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

    logger.info('📥 Agregando item a cotización:', quoteId, body)

    // Los IDs de adicionales de catálogo se resuelven en una sola query
    const additionalProductIds: string[] = (body.additionals || [])
      .map((add: { productId?: string | null }) => add.productId)
      .filter(Boolean)

    // Quote, producto y productos de adicionales se buscan en paralelo
    const [quote, product, additionalProducts] = await Promise.all([
      prisma.quote.findUnique({
        where: { id: quoteId },
        select: {
          id: true,
          multiplier: true,
          pricesIncludeTax: true,
          bonification: true,
          items: {
            select: {
              id: true,
              itemNumber: true,
              isAlternative: true,
              totalPrice: true,
            },
          },
        },
      }),
      body.productId
        ? prisma.product.findUnique({
            where: { id: body.productId },
            include: { category: true },
          })
        : Promise.resolve(null),
      additionalProductIds.length > 0
        ? prisma.product.findMany({
            where: { id: { in: additionalProductIds } },
            select: { id: true, listPriceUSD: true },
          })
        : Promise.resolve([]),
    ])

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

    // Subtotal de los items principales ya existentes (el nuevo se suma después)
    const existingSubtotal = quote.items
      .filter((i) => !i.isAlternative)
      .reduce((sum, i) => sum + Number(i.totalPrice), 0)
    const bonif = Number(quote.bonification) || 0

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
      const multiplierOverride = body.multiplierOverride !== undefined && body.multiplierOverride !== null && body.multiplierOverride !== ''
        ? Number(body.multiplierOverride)
        : null
      const customerMultiplier = multiplierOverride ?? (Number(quote.multiplier) || 1)
      // Si la cotización está en modo IVA-incluido (Factura B), el unitPrice final
      // debe incluir el 21% de IVA para que cuadre con el total que factura AFIP.
      const ivaFactor = quote.pricesIncludeTax ? 1.21 : 1
      const manualUnitPrice = manualPrice * customerMultiplier * ivaFactor
      const manualTotalPrice = manualUnitPrice * quantity

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
        multiplierOverride,
        unitPrice: manualUnitPrice,
        totalPrice: manualTotalPrice,
        deliveryTime: body.deliveryTime || 'A confirmar',
        isAlternative: body.isAlternative || false,
      }
      if (body.alternativeToItemId) {
        manualData.alternativeToItem = { connect: { id: body.alternativeToItemId } }
      }

      const subtotal = existingSubtotal + (manualData.isAlternative ? 0 : manualTotalPrice)
      const [item] = await prisma.$transaction([
        prisma.quoteItem.create({
          data: manualData,
          include: {
            product: true,
            additionals: { include: { product: true } },
          },
        }),
        prisma.quote.update({
          where: { id: quoteId },
          data: { subtotal, total: subtotal * (1 - bonif / 100) },
        }),
      ])

      logger.info('✅ Item manual agregado:', item.id)
      return NextResponse.json(item, { status: 201 })
    }

    // ── ITEM DE CATÁLOGO ──
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
      const [exactMatch, genericMatch] = await Promise.all([
        prisma.brandDiscount.findUnique({
          where: {
            brand_productType: {
              brand: product.brand,
              productType: product.category?.name || ''
            }
          }
        }),
        prisma.brandDiscount.findFirst({
          where: { brand: product.brand }
        }),
      ])
      const brandDiscountData = exactMatch || genericMatch
      if (brandDiscountData) {
        brandDiscount = Number(brandDiscountData.discountPercent) / 100
      }
    }

    const listPrice = Number(product.listPriceUSD || 0)
    let additionalsPrices = 0

    if (body.additionals && body.additionals.length > 0) {
      const addPriceById = new Map(
        additionalProducts.map((p) => [p.id, Number(p.listPriceUSD || 0)])
      )
      for (const add of body.additionals) {
        if (add.productId) {
          // Adicional de catálogo: precio del producto (ya resuelto arriba)
          additionalsPrices += addPriceById.get(add.productId) || 0
        } else {
          // Adicional manual: usar listPrice del request directo
          additionalsPrices += Number(add.listPrice || 0)
        }
      }
    }

    const subtotalWithAdditionals = listPrice + additionalsPrices
    const afterDiscount = subtotalWithAdditionals * (1 - brandDiscount)
    const catMultiplierOverride = body.multiplierOverride !== undefined && body.multiplierOverride !== null && body.multiplierOverride !== ''
      ? Number(body.multiplierOverride)
      : null
    const customerMultiplier = catMultiplierOverride ?? Number(quote.multiplier)
    // Cotizaciones con pricesIncludeTax escalan 1.21 para facturar con IVA incluido.
    const catIvaFactor = quote.pricesIncludeTax ? 1.21 : 1
    const unitPrice = afterDiscount * customerMultiplier * catIvaFactor
    const quantity = body.quantity || 1
    const totalPrice = unitPrice * quantity

    const isAlternative = body.isAlternative || false
    const subtotal = existingSubtotal + (isAlternative ? 0 : totalPrice)

    const [item] = await prisma.$transaction([
      prisma.quoteItem.create({
        data: {
          quoteId,
          itemNumber,
          productId: body.productId,
          description: body.description,
          quantity,
          listPrice,
          brandDiscount,
          customerMultiplier,
          multiplierOverride: catMultiplierOverride,
          unitPrice,
          totalPrice,
          deliveryTime: body.deliveryTime || 'Inmediato',
          isAlternative,
          ...(body.alternativeToItemId ? { alternativeToItemId: body.alternativeToItemId } : {}),
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
      }),
      prisma.quote.update({
        where: { id: quoteId },
        data: { subtotal, total: subtotal * (1 - bonif / 100) },
      }),
    ])

    logger.info('✅ Item agregado:', item.id)

    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    logger.error('❌ Error al agregar item:', error)
    return NextResponse.json(
      {
        error: 'Error al agregar item',
        message: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 }
    )
  }
}

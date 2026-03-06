import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * ENDPOINT TEMPORAL DE DIAGNÓSTICO
 * Para debuggear por qué el tablero Kanban clasifica mal los items.
 * ELIMINAR después de resolver el bug.
 */
export async function POST() {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // 1. Buscar TODAS las cotizaciones ACCEPTED con items y productos
    const allAcceptedQuotes = await prisma.quote.findMany({
      where: { status: 'ACCEPTED' },
      select: {
        id: true,
        quoteNumber: true,
        status: true,
        currency: true,
        items: {
          where: { isAlternative: false },
          select: {
            id: true,
            itemNumber: true,
            description: true,
            quantity: true,
            deliveryTime: true,
            isAlternative: true,
            productId: true,
            manualSku: true,
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                stockQuantity: true,
              },
            },
            invoiceItems: {
              select: {
                id: true,
                quantity: true,
                invoice: {
                  select: {
                    id: true,
                    status: true,
                    notes: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    // 2. Buscar producto "2413 05" directamente
    const product241305 = await prisma.product.findFirst({
      where: {
        OR: [
          { sku: '2413 05' },
          { sku: '241305' },
          { sku: { contains: '2413' } },
        ],
      },
      select: {
        id: true,
        sku: true,
        name: true,
        stockQuantity: true,
        status: true,
        colppyItemId: true,
        colppyCode: true,
      },
    })

    // 3. Buscar TODOS los productos que tengan stock > 0
    const productsWithStock = await prisma.product.findMany({
      where: { stockQuantity: { gt: 0 } },
      select: {
        id: true,
        sku: true,
        name: true,
        stockQuantity: true,
      },
      take: 50,
    })

    // 4. Procesar cada cotización con la MISMA lógica del board
    const debugResults = allAcceptedQuotes.map((quote) => {
      const itemsDebug = quote.items.map((item) => {
        const invoicedQuantity = item.invoiceItems
          .filter((ii) => ii.invoice.status !== 'CANCELLED')
          .reduce((sum, ii) => sum + Number(ii.quantity), 0)

        const remainingQuantity = item.quantity - invoicedQuantity
        const stockQty = item.product?.stockQuantity ?? null

        // Replicar exactamente la lógica del board
        const deliveryTime = item.deliveryTime
        const isDeliveryImmediate = !deliveryTime ||
          deliveryTime.trim().toLowerCase() === 'inmediato' ||
          deliveryTime.trim().toLowerCase() === 'inmediata' ||
          deliveryTime.trim().toLowerCase() === 'stock'

        const isReadyByStock = stockQty != null && stockQty >= Math.max(remainingQuantity, 0)
        const isReady = isDeliveryImmediate || isReadyByStock

        return {
          itemId: item.id,
          itemNumber: item.itemNumber,
          description: item.description,
          productId: item.productId,
          productSku: item.product?.sku || item.manualSku || null,
          productName: item.product?.name || null,
          hasProduct: !!item.product,

          // Valores crudos con tipos
          raw: {
            'item.quantity': item.quantity,
            'typeof item.quantity': typeof item.quantity,
            'item.deliveryTime': item.deliveryTime,
            'typeof item.deliveryTime': typeof item.deliveryTime,
            'item.product?.stockQuantity': item.product?.stockQuantity,
            'typeof item.product?.stockQuantity': typeof item.product?.stockQuantity,
            'stockQty (after ?? null)': stockQty,
            'typeof stockQty': typeof stockQty,
          },

          // Cálculos intermedios
          calc: {
            invoicedQuantity,
            'typeof invoicedQuantity': typeof invoicedQuantity,
            remainingQuantity,
            'typeof remainingQuantity': typeof remainingQuantity,
            'Math.max(remainingQuantity, 0)': Math.max(remainingQuantity, 0),
          },

          // Evaluación isItemReady
          readyEval: {
            isDeliveryImmediate,
            'deliveryTime?.trim().toLowerCase()': deliveryTime?.trim().toLowerCase() || null,
            'stockQty != null': stockQty != null,
            'stockQty >= Math.max(remainingQuantity, 0)': stockQty != null ? stockQty >= Math.max(remainingQuantity, 0) : 'N/A (stockQty is null)',
            isReadyByStock,
            isReady,
          },

          // Invoice items detail
          invoiceItems: item.invoiceItems.map((ii) => ({
            id: ii.id,
            quantity: ii.quantity,
            'typeof quantity': typeof ii.quantity,
            'Number(quantity)': Number(ii.quantity),
            invoiceStatus: ii.invoice.status,
            invoiceNotes: ii.invoice.notes,
          })),
        }
      })

      // Clasificación final
      const pendingItems = itemsDebug.filter(
        (i) => i.calc.remainingQuantity > 0
      )
      const readyCount = pendingItems.filter(
        (i) => i.readyEval.isReady
      ).length

      let column: string
      if (pendingItems.length === 0) column = 'FULLY_INVOICED (skip)'
      else if (readyCount === pendingItems.length) column = 'ready'
      else if (readyCount === 0) column = 'pending'
      else column = 'partial'

      return {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        status: quote.status,
        currency: quote.currency,
        totalItems: quote.items.length,
        pendingItemsCount: pendingItems.length,
        readyCount,
        column,
        items: itemsDebug,
      }
    })

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      totalAcceptedQuotes: allAcceptedQuotes.length,

      // Producto 2413 05 directamente
      product241305: product241305
        ? {
            ...product241305,
            'typeof stockQuantity': typeof product241305.stockQuantity,
          }
        : 'NOT FOUND',

      // Productos con stock > 0
      productsWithStock: {
        count: productsWithStock.length,
        items: productsWithStock.map((p) => ({
          ...p,
          'typeof stockQuantity': typeof p.stockQuantity,
        })),
      },

      // Diagnóstico detallado por cotización
      quotes: debugResults,
    })
  } catch (error) {
    console.error('Debug board error:', error)
    return NextResponse.json(
      {
        error: 'Error en diagnóstico',
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    )
  }
}

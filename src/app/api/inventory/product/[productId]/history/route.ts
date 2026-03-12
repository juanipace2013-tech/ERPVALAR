import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { StockMovementType } from '@prisma/client'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { productId } = await params
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
    const type = searchParams.get('type') as StockMovementType | null
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true, sku: true, name: true,
        stockQuantity: true, averageCost: true, lastCost: true,
        minStock: true, maxStock: true,
      },
    })

    if (!product) {
      return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 })
    }

    const where = {
      productId,
      ...(type ? { type } : {}),
      ...(dateFrom || dateTo ? {
        date: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(dateTo) } : {}),
        },
      } : {}),
    }

    const [movements, count] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        orderBy: { date: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
        include: {
          user: { select: { name: true } },
          invoice: { select: { id: true, invoiceNumber: true } },
          purchaseInvoice: {
            select: {
              id: true,
              invoiceNumber: true,
              supplier: { select: { name: true } },
            },
          },
        },
      }),
      prisma.stockMovement.count({ where }),
    ])

    // Summary
    const entryTypes: StockMovementType[] = ['COMPRA', 'AJUSTE_POSITIVO', 'DEVOLUCION_CLIENTE']
    const exitTypes: StockMovementType[] = ['VENTA', 'AJUSTE_NEGATIVO', 'DEVOLUCION_PROVEEDOR']

    const [totalIn, totalOut, totalAdjustments] = await Promise.all([
      prisma.stockMovement.aggregate({
        where: { productId, type: { in: entryTypes } },
        _sum: { quantity: true },
      }),
      prisma.stockMovement.aggregate({
        where: { productId, type: { in: exitTypes } },
        _sum: { quantity: true },
      }),
      prisma.stockMovement.count({
        where: { productId, type: { in: ['AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO'] } },
      }),
    ])

    return NextResponse.json({
      product,
      movements: movements.map(m => ({
        id: m.id,
        type: m.type,
        quantity: m.quantity,
        unitCost: Number(m.unitCost),
        totalCost: Number(m.totalCost),
        stockBefore: m.stockBefore,
        stockAfter: m.stockAfter,
        reference: m.reference,
        notes: m.notes,
        date: m.date,
        userName: m.user.name,
        invoice: m.invoice,
        purchaseInvoice: m.purchaseInvoice ? {
          id: m.purchaseInvoice.id,
          invoiceNumber: m.purchaseInvoice.invoiceNumber,
          supplierName: m.purchaseInvoice.supplier.name,
        } : null,
      })),
      summary: {
        totalIn: totalIn._sum.quantity || 0,
        totalOut: Math.abs(totalOut._sum.quantity || 0),
        totalAdjustments,
        currentStock: product.stockQuantity,
        avgCost: Number(product.averageCost || 0),
      },
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    })
  } catch (error: unknown) {
    console.error('Error in product history:', error)
    const message = error instanceof Error ? error.message : 'Error al cargar historial'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

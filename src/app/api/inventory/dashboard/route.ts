import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const supplierId = searchParams.get('supplierId')

    const now = new Date()
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)

    const productWhere = {
      trackInventory: true,
      status: 'ACTIVE' as const,
      ...(supplierId ? { supplierId } : {}),
    }

    const [
      totalProducts,
      productsWithStock,
      productsOutOfStock,
      allTrackedProducts,
      recentMovements,
      purchaseGrouped,
      allProductsForNoMovement,
      purchaseMovementsForMonthly,
    ] = await Promise.all([
      // Total products tracked
      prisma.product.count({ where: productWhere }),

      // Products with stock > 0
      prisma.product.count({ where: { ...productWhere, stockQuantity: { gt: 0 } } }),

      // Products out of stock with minStock set
      prisma.product.count({
        where: { ...productWhere, minStock: { gt: 0 }, stockQuantity: { equals: 0 } },
      }),

      // All tracked products with minStock > 0 (for below-min count + list + inventory value)
      prisma.product.findMany({
        where: { ...productWhere, minStock: { gt: 0 } },
        select: {
          id: true, sku: true, name: true, brand: true, supplierId: true,
          stockQuantity: true, minStock: true, lastCost: true, averageCost: true,
        },
      }),

      // Recent 20 movements
      prisma.stockMovement.findMany({
        take: 20,
        orderBy: { date: 'desc' },
        include: {
          product: { select: { sku: true, name: true } },
          user: { select: { name: true } },
        },
      }),

      // Top purchased last 90 days - groupBy productId
      prisma.stockMovement.groupBy({
        by: ['productId'],
        where: {
          type: 'COMPRA',
          date: { gte: ninetyDaysAgo },
          ...(supplierId ? { product: { supplierId } } : {}),
        },
        _sum: { quantity: true, totalCost: true },
        _count: { id: true },
        _max: { date: true },
        orderBy: { _sum: { totalCost: 'desc' } },
        take: 15,
      }),

      // Products for no-movement check
      prisma.product.findMany({
        where: { ...productWhere, stockQuantity: { gt: 0 } },
        select: {
          id: true, sku: true, name: true, brand: true,
          stockQuantity: true, averageCost: true,
          stockMovements: {
            take: 1,
            orderBy: { date: 'desc' },
            select: { date: true },
          },
        },
      }),

      // All purchase movements for monthly chart
      prisma.stockMovement.findMany({
        where: { type: 'COMPRA', date: { gte: twelveMonthsAgo } },
        select: { date: true, totalCost: true, quantity: true, purchaseInvoiceId: true },
      }),
    ])

    // --- Compute below minimum (column comparison done in JS) ---
    const belowMinProducts = allTrackedProducts
      .filter(p => p.stockQuantity < p.minStock)

    const productsBelowMin = belowMinProducts.length

    const belowMinimum = belowMinProducts
      .map(p => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        brand: p.brand,
        supplierId: p.supplierId,
        stockQuantity: p.stockQuantity,
        minStock: p.minStock,
        deficit: p.minStock - p.stockQuantity,
        lastCost: Number(p.lastCost || 0),
        averageCost: Number(p.averageCost || 0),
      }))
      .sort((a, b) => b.deficit - a.deficit)
      .slice(0, 20)

    // --- Inventory value (all tracked products with stock) ---
    const allForValue = await prisma.product.findMany({
      where: { ...productWhere, stockQuantity: { gt: 0 } },
      select: { stockQuantity: true, averageCost: true },
    })
    const totalInventoryValue = allForValue.reduce(
      (sum, p) => sum + p.stockQuantity * Number(p.averageCost || 0), 0
    )

    // --- Enrich top purchased with product info ---
    const purchaseProductIds = purchaseGrouped.map(g => g.productId)
    const purchaseProducts = purchaseProductIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: purchaseProductIds } },
          select: { id: true, sku: true, name: true, brand: true },
        })
      : []
    const productMap = new Map(purchaseProducts.map(p => [p.id, p]))

    const topPurchased = purchaseGrouped.map(g => {
      const prod = productMap.get(g.productId)
      return {
        productId: g.productId,
        sku: prod?.sku || '',
        name: prod?.name || '',
        brand: prod?.brand || null,
        totalQtyPurchased: g._sum.quantity || 0,
        totalValuePurchased: Number(g._sum.totalCost || 0),
        purchaseCount: g._count.id,
        lastPurchaseDate: g._max.date,
      }
    })

    // --- No-movement products ---
    const noMovement = allProductsForNoMovement
      .filter(p => {
        const lastMove = p.stockMovements[0]?.date
        if (!lastMove) return true
        return (now.getTime() - new Date(lastMove).getTime()) > 90 * 24 * 60 * 60 * 1000
      })
      .map(p => {
        const lastMoveDate = p.stockMovements[0]?.date || null
        const daysWithout = lastMoveDate
          ? Math.floor((now.getTime() - new Date(lastMoveDate).getTime()) / (1000 * 60 * 60 * 24))
          : 999
        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          brand: p.brand,
          stockQuantity: p.stockQuantity,
          lastMovementDate: lastMoveDate,
          daysWithoutMovement: daysWithout,
          inventoryValue: p.stockQuantity * Number(p.averageCost || 0),
        }
      })
      .sort((a, b) => b.inventoryValue - a.inventoryValue)
      .slice(0, 20)

    // --- Purchases by month (group in JS) ---
    const monthMap = new Map<string, { totalValue: number; totalQty: number; invoiceIds: Set<string> }>()
    for (const m of purchaseMovementsForMonthly) {
      const key = `${m.date.getFullYear()}-${String(m.date.getMonth() + 1).padStart(2, '0')}`
      const entry = monthMap.get(key) || { totalValue: 0, totalQty: 0, invoiceIds: new Set<string>() }
      entry.totalValue += Number(m.totalCost || 0)
      entry.totalQty += m.quantity
      if (m.purchaseInvoiceId) entry.invoiceIds.add(m.purchaseInvoiceId)
      monthMap.set(key, entry)
    }
    const purchasesByMonth = Array.from(monthMap.entries())
      .map(([month, data]) => ({
        month,
        totalValue: data.totalValue,
        totalQty: data.totalQty,
        invoiceCount: data.invoiceIds.size,
      }))
      .sort((a, b) => a.month.localeCompare(b.month))

    return NextResponse.json({
      summary: {
        totalProducts,
        productsWithStock,
        productsBelowMin,
        productsOutOfStock,
        totalInventoryValue,
      },
      belowMinimum,
      topPurchased,
      noMovement,
      recentMovements: recentMovements.map(m => ({
        id: m.id,
        product: m.product,
        type: m.type,
        quantity: m.quantity,
        unitCost: Number(m.unitCost),
        reference: m.reference,
        date: m.date,
        userName: m.user.name,
      })),
      purchasesByMonth,
    })
  } catch (error: unknown) {
    console.error('Error in inventory dashboard:', error)
    const message = error instanceof Error ? error.message : 'Error al cargar dashboard'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

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
    const period = parseInt(searchParams.get('period') || '12')
    const supplierId = searchParams.get('supplierId')

    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth() - period, now.getDate())
    const periodDays = Math.floor((now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24))

    // Get all purchase movements in the period with product data
    const movements = await prisma.stockMovement.findMany({
      where: {
        type: 'COMPRA',
        date: { gte: periodStart },
        ...(supplierId ? { product: { supplierId } } : {}),
      },
      select: {
        id: true,
        productId: true,
        quantity: true,
        totalCost: true,
        date: true,
        product: {
          select: {
            id: true, sku: true, name: true, brand: true,
            stockQuantity: true, minStock: true,
            supplier: { select: { name: true } },
          },
        },
      },
      orderBy: { date: 'asc' },
    })

    if (movements.length === 0) {
      return NextResponse.json({
        products: [],
        summary: {
          totalProducts: 0,
          categoryA: { count: 0, totalValue: 0, percentOfTotal: 0 },
          categoryB: { count: 0, totalValue: 0, percentOfTotal: 0 },
          categoryC: { count: 0, totalValue: 0, percentOfTotal: 0 },
        },
      })
    }

    // Group movements by productId
    const grouped = new Map<string, {
      product: typeof movements[0]['product'];
      movementIds: Set<string>;
      totalQty: number;
      totalValue: number;
      dates: Date[];
    }>()

    for (const m of movements) {
      const existing = grouped.get(m.productId)
      if (existing) {
        existing.movementIds.add(m.id)
        existing.totalQty += m.quantity
        existing.totalValue += Number(m.totalCost || 0)
        existing.dates.push(m.date)
      } else {
        grouped.set(m.productId, {
          product: m.product,
          movementIds: new Set([m.id]),
          totalQty: m.quantity,
          totalValue: Number(m.totalCost || 0),
          dates: [m.date],
        })
      }
    }

    // Sort by total value descending for ABC classification
    const sortedEntries = Array.from(grouped.entries())
      .sort((a, b) => b[1].totalValue - a[1].totalValue)

    const totalValue = sortedEntries.reduce((sum, [, data]) => sum + data.totalValue, 0)

    // ABC Classification + metrics
    let cumulativeValue = 0
    const products = sortedEntries.map(([productId, data]) => {
      cumulativeValue += data.totalValue
      const cumulativePercent = totalValue > 0 ? (cumulativeValue / totalValue) * 100 : 0

      let abcCategory: 'A' | 'B' | 'C'
      if (cumulativePercent <= 80) abcCategory = 'A'
      else if (cumulativePercent <= 95) abcCategory = 'B'
      else abcCategory = 'C'

      const purchaseCount = data.movementIds.size
      const avgQtyPerPurchase = purchaseCount > 0
        ? Math.round(data.totalQty / purchaseCount)
        : 0

      // Average days between purchases
      const sortedDates = data.dates.sort((a, b) => a.getTime() - b.getTime())
      const firstDate = sortedDates[0]
      const lastDate = sortedDates[sortedDates.length - 1]
      const daySpan = Math.max(1, Math.floor((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)))
      const avgDaysBetweenPurchases = purchaseCount > 1
        ? Math.round(daySpan / (purchaseCount - 1))
        : periodDays

      const daysSinceLastPurchase = Math.floor(
        (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
      )

      // Daily consumption estimate
      const dailyConsumption = data.totalQty / periodDays
      const currentStock = data.product.stockQuantity
      const estimatedDaysUntilStockout = dailyConsumption > 0
        ? Math.round(currentStock / dailyConsumption)
        : currentStock > 0 ? 999 : 0

      // Suggested reorder
      const leadTimeDays = avgDaysBetweenPurchases
      const suggestedReorderQty = Math.max(
        0,
        Math.round(dailyConsumption * leadTimeDays * 1.5) - currentStock
      )

      return {
        productId,
        sku: data.product.sku,
        name: data.product.name,
        brand: data.product.brand,
        supplierName: data.product.supplier?.name || null,
        currentStock,
        minStock: data.product.minStock,
        purchaseCount,
        totalQtyPurchased: data.totalQty,
        totalValuePurchased: data.totalValue,
        firstPurchaseDate: firstDate,
        lastPurchaseDate: lastDate,
        avgQtyPerPurchase,
        avgDaysBetweenPurchases,
        daysSinceLastPurchase,
        abcCategory,
        cumulativeValuePercent: Math.round(cumulativePercent * 100) / 100,
        estimatedDaysUntilStockout,
        suggestedReorderQty,
      }
    })

    // Summary by category
    const categoryA = products.filter(p => p.abcCategory === 'A')
    const categoryB = products.filter(p => p.abcCategory === 'B')
    const categoryC = products.filter(p => p.abcCategory === 'C')

    return NextResponse.json({
      products,
      summary: {
        totalProducts: products.length,
        categoryA: {
          count: categoryA.length,
          totalValue: categoryA.reduce((s, p) => s + p.totalValuePurchased, 0),
          percentOfTotal: totalValue > 0 ? Math.round((categoryA.reduce((s, p) => s + p.totalValuePurchased, 0) / totalValue) * 10000) / 100 : 0,
        },
        categoryB: {
          count: categoryB.length,
          totalValue: categoryB.reduce((s, p) => s + p.totalValuePurchased, 0),
          percentOfTotal: totalValue > 0 ? Math.round((categoryB.reduce((s, p) => s + p.totalValuePurchased, 0) / totalValue) * 10000) / 100 : 0,
        },
        categoryC: {
          count: categoryC.length,
          totalValue: categoryC.reduce((s, p) => s + p.totalValuePurchased, 0),
          percentOfTotal: totalValue > 0 ? Math.round((categoryC.reduce((s, p) => s + p.totalValuePurchased, 0) / totalValue) * 10000) / 100 : 0,
        },
      },
    })
  } catch (error: unknown) {
    console.error('Error in rotation analysis:', error)
    const message = error instanceof Error ? error.message : 'Error al calcular rotación'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

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

    // Get all purchase movements in the period grouped by product
    const productPurchases = await prisma.$queryRaw<Array<{
      productId: string; sku: string; name: string; brand: string | null;
      supplierName: string | null; currentStock: number; minStock: number;
      purchaseCount: number; totalQtyPurchased: number;
      totalValuePurchased: number; firstPurchaseDate: Date;
      lastPurchaseDate: Date;
    }>>`
      SELECT
        p.id as "productId", p.sku, p.name, p.brand,
        s.name as "supplierName",
        p."stockQuantity" as "currentStock",
        p."minStock",
        COUNT(DISTINCT sm.id)::int as "purchaseCount",
        SUM(sm.quantity)::int as "totalQtyPurchased",
        SUM(sm."totalCost")::float as "totalValuePurchased",
        MIN(sm.date) as "firstPurchaseDate",
        MAX(sm.date) as "lastPurchaseDate"
      FROM stock_movements sm
      JOIN products p ON p.id = sm."productId"
      LEFT JOIN suppliers s ON s.id = p."supplierId"
      WHERE sm.type = 'COMPRA' AND sm.date >= ${periodStart}
        ${supplierId ? prisma.$queryRaw`AND p."supplierId" = ${supplierId}` : prisma.$queryRaw``}
      GROUP BY p.id, p.sku, p.name, p.brand, s.name, p."stockQuantity", p."minStock"
      ORDER BY SUM(sm."totalCost") DESC
    `

    if (productPurchases.length === 0) {
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

    // Calculate total value for ABC
    const totalValue = productPurchases.reduce((sum, p) => sum + p.totalValuePurchased, 0)

    // ABC Classification + metrics
    let cumulativeValue = 0
    const products = productPurchases.map(p => {
      cumulativeValue += p.totalValuePurchased
      const cumulativePercent = (cumulativeValue / totalValue) * 100

      let abcCategory: 'A' | 'B' | 'C'
      if (cumulativePercent <= 80) abcCategory = 'A'
      else if (cumulativePercent <= 95) abcCategory = 'B'
      else abcCategory = 'C'

      const avgQtyPerPurchase = p.purchaseCount > 0
        ? Math.round(p.totalQtyPurchased / p.purchaseCount)
        : 0

      // Average days between purchases
      const firstDate = new Date(p.firstPurchaseDate)
      const lastDate = new Date(p.lastPurchaseDate)
      const daySpan = Math.max(1, Math.floor((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)))
      const avgDaysBetweenPurchases = p.purchaseCount > 1
        ? Math.round(daySpan / (p.purchaseCount - 1))
        : periodDays

      const daysSinceLastPurchase = Math.floor(
        (now.getTime() - new Date(p.lastPurchaseDate).getTime()) / (1000 * 60 * 60 * 24)
      )

      // Daily consumption estimate
      const dailyConsumption = p.totalQtyPurchased / periodDays
      const estimatedDaysUntilStockout = dailyConsumption > 0
        ? Math.round(p.currentStock / dailyConsumption)
        : p.currentStock > 0 ? 999 : 0

      // Suggested reorder: cover avg lead time (use avgDaysBetweenPurchases) + 50% safety
      const leadTimeDays = avgDaysBetweenPurchases
      const suggestedReorderQty = Math.max(
        0,
        Math.round(dailyConsumption * leadTimeDays * 1.5) - p.currentStock
      )

      return {
        ...p,
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

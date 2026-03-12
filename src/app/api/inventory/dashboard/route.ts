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
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

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
      productsBelowMin,
      productsOutOfStock,
      inventoryValue,
      belowMinimum,
      recentMovements,
      purchaseMovements90d,
      allProductsForNoMovement,
    ] = await Promise.all([
      // Total products tracked
      prisma.product.count({ where: productWhere }),

      // Products with stock > 0
      prisma.product.count({ where: { ...productWhere, stockQuantity: { gt: 0 } } }),

      // Products below min stock
      prisma.product.count({
        where: { ...productWhere, minStock: { gt: 0 }, stockQuantity: { lt: prisma.product.fields?.minStock || 0 } },
      }).catch(() =>
        // Fallback: raw query for self-referencing comparison
        prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*)::bigint as count FROM products
          WHERE "trackInventory" = true AND status = 'ACTIVE'
          AND "minStock" > 0 AND "stockQuantity" < "minStock"
          ${supplierId ? prisma.$queryRaw`AND "supplierId" = ${supplierId}` : prisma.$queryRaw``}
        `.then(r => Number(r[0]?.count || 0))
      ),

      // Products out of stock with minStock set
      prisma.product.count({
        where: { ...productWhere, minStock: { gt: 0 }, stockQuantity: { equals: 0 } },
      }),

      // Total inventory value
      prisma.$queryRaw<[{ total: number }]>`
        SELECT COALESCE(SUM("stockQuantity" * COALESCE("averageCost", 0)), 0)::float as total
        FROM products WHERE "trackInventory" = true AND status = 'ACTIVE'
        ${supplierId ? prisma.$queryRaw`AND "supplierId" = ${supplierId}` : prisma.$queryRaw``}
      `,

      // Below minimum - top 20
      prisma.$queryRaw<Array<{
        id: string; sku: string; name: string; brand: string | null;
        supplierId: string | null; stockQuantity: number; minStock: number;
        deficit: number; lastCost: number; averageCost: number;
      }>>`
        SELECT p.id, p.sku, p.name, p.brand, p."supplierId",
          p."stockQuantity", p."minStock",
          (p."minStock" - p."stockQuantity") as deficit,
          COALESCE(p."lastCost", 0)::float as "lastCost",
          COALESCE(p."averageCost", 0)::float as "averageCost"
        FROM products p
        WHERE p."trackInventory" = true AND p.status = 'ACTIVE'
          AND p."minStock" > 0 AND p."stockQuantity" < p."minStock"
          ${supplierId ? prisma.$queryRaw`AND p."supplierId" = ${supplierId}` : prisma.$queryRaw``}
        ORDER BY (p."minStock" - p."stockQuantity") DESC
        LIMIT 20
      `,

      // Recent 20 movements
      prisma.stockMovement.findMany({
        take: 20,
        orderBy: { date: 'desc' },
        include: {
          product: { select: { sku: true, name: true } },
          user: { select: { name: true } },
        },
      }),

      // Top purchased last 90 days
      prisma.$queryRaw<Array<{
        productId: string; sku: string; name: string; brand: string | null;
        totalQtyPurchased: number; totalValuePurchased: number;
        purchaseCount: number; lastPurchaseDate: Date;
      }>>`
        SELECT sm."productId", p.sku, p.name, p.brand,
          SUM(sm.quantity)::int as "totalQtyPurchased",
          SUM(sm."totalCost")::float as "totalValuePurchased",
          COUNT(*)::int as "purchaseCount",
          MAX(sm.date) as "lastPurchaseDate"
        FROM stock_movements sm
        JOIN products p ON p.id = sm."productId"
        WHERE sm.type = 'COMPRA' AND sm.date >= ${ninetyDaysAgo}
          ${supplierId ? prisma.$queryRaw`AND p."supplierId" = ${supplierId}` : prisma.$queryRaw``}
        GROUP BY sm."productId", p.sku, p.name, p.brand
        ORDER BY SUM(sm."totalCost") DESC
        LIMIT 15
      `,

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
    ])

    // Calculate no-movement products
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

    // Purchases by month (last 12 months)
    const purchasesByMonth = await prisma.$queryRaw<Array<{
      month: string; totalValue: number; totalQty: number; invoiceCount: number;
    }>>`
      SELECT
        TO_CHAR(sm.date, 'YYYY-MM') as month,
        SUM(sm."totalCost")::float as "totalValue",
        SUM(sm.quantity)::int as "totalQty",
        COUNT(DISTINCT sm."purchaseInvoiceId")::int as "invoiceCount"
      FROM stock_movements sm
      WHERE sm.type = 'COMPRA' AND sm.date >= ${twelveMonthsAgo}
      GROUP BY TO_CHAR(sm.date, 'YYYY-MM')
      ORDER BY month ASC
    `

    return NextResponse.json({
      summary: {
        totalProducts,
        productsWithStock,
        productsBelowMin: typeof productsBelowMin === 'number' ? productsBelowMin : Number(productsBelowMin),
        productsOutOfStock,
        totalInventoryValue: Number(inventoryValue[0]?.total || 0),
      },
      belowMinimum,
      topPurchased: purchaseMovements90d,
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

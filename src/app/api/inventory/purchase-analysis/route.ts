import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const groupBy = searchParams.get('groupBy') || 'product'
    const period = parseInt(searchParams.get('period') || '12')
    const supplierId = searchParams.get('supplierId')
    const productId = searchParams.get('productId')

    const periodStart = new Date()
    periodStart.setMonth(periodStart.getMonth() - period)

    if (groupBy === 'product') {
      const supplierFilter = supplierId
        ? Prisma.sql`AND p."supplierId" = ${supplierId}`
        : Prisma.sql``
      const productFilter = productId
        ? Prisma.sql`AND p.id = ${productId}`
        : Prisma.sql``

      const data = await prisma.$queryRaw<Array<{
        productId: string; sku: string; name: string; brand: string | null;
        supplierName: string | null; totalQty: number; totalValue: number;
        invoiceCount: number; lastPrice: number; firstPrice: number;
      }>>`
        SELECT
          p.id as "productId", p.sku, p.name, p.brand,
          s.name as "supplierName",
          SUM(sm.quantity)::int as "totalQty",
          SUM(sm."totalCost")::float as "totalValue",
          COUNT(DISTINCT sm."purchaseInvoiceId")::int as "invoiceCount",
          (SELECT sm2."unitCost"::float FROM stock_movements sm2
           WHERE sm2."productId" = p.id AND sm2.type = 'COMPRA'
           ORDER BY sm2.date DESC LIMIT 1) as "lastPrice",
          (SELECT sm3."unitCost"::float FROM stock_movements sm3
           WHERE sm3."productId" = p.id AND sm3.type = 'COMPRA'
           ORDER BY sm3.date ASC LIMIT 1) as "firstPrice"
        FROM stock_movements sm
        JOIN products p ON p.id = sm."productId"
        LEFT JOIN suppliers s ON s.id = p."supplierId"
        WHERE sm.type = 'COMPRA' AND sm.date >= ${periodStart}
          ${supplierFilter}
          ${productFilter}
        GROUP BY p.id, p.sku, p.name, p.brand, s.name
        ORDER BY SUM(sm."totalCost") DESC
      `

      return NextResponse.json({
        groupBy: 'product',
        data: data.map(d => ({
          ...d,
          priceVariation: d.firstPrice && d.firstPrice > 0
            ? Math.round(((d.lastPrice - d.firstPrice) / d.firstPrice) * 10000) / 100
            : 0,
        })),
      })
    }

    if (groupBy === 'supplier') {
      const supplierFilter = supplierId
        ? Prisma.sql`AND s.id = ${supplierId}`
        : Prisma.sql``

      const data = await prisma.$queryRaw<Array<{
        supplierId: string; supplierName: string;
        totalItems: number; totalValue: number; invoiceCount: number;
      }>>`
        SELECT
          s.id as "supplierId", s.name as "supplierName",
          SUM(sm.quantity)::int as "totalItems",
          SUM(sm."totalCost")::float as "totalValue",
          COUNT(DISTINCT sm."purchaseInvoiceId")::int as "invoiceCount"
        FROM stock_movements sm
        JOIN products p ON p.id = sm."productId"
        JOIN suppliers s ON s.id = p."supplierId"
        WHERE sm.type = 'COMPRA' AND sm.date >= ${periodStart}
          ${supplierFilter}
        GROUP BY s.id, s.name
        ORDER BY SUM(sm."totalCost") DESC
      `

      // Get top 5 products per supplier
      const enriched = await Promise.all(
        data.map(async (supplier) => {
          const topProducts = await prisma.$queryRaw<Array<{
            name: string; totalValue: number;
          }>>`
            SELECT p.name, SUM(sm."totalCost")::float as "totalValue"
            FROM stock_movements sm
            JOIN products p ON p.id = sm."productId"
            WHERE sm.type = 'COMPRA' AND sm.date >= ${periodStart}
              AND p."supplierId" = ${supplier.supplierId}
            GROUP BY p.name
            ORDER BY SUM(sm."totalCost") DESC
            LIMIT 5
          `
          return { ...supplier, topProducts }
        })
      )

      return NextResponse.json({ groupBy: 'supplier', data: enriched })
    }

    if (groupBy === 'month') {
      const data = await prisma.$queryRaw<Array<{
        month: string; totalValue: number; totalQty: number;
        invoiceCount: number; topSupplier: string | null;
      }>>`
        SELECT
          TO_CHAR(sm.date, 'YYYY-MM') as month,
          SUM(sm."totalCost")::float as "totalValue",
          SUM(sm.quantity)::int as "totalQty",
          COUNT(DISTINCT sm."purchaseInvoiceId")::int as "invoiceCount",
          (SELECT s2.name FROM stock_movements sm2
           JOIN products p2 ON p2.id = sm2."productId"
           JOIN suppliers s2 ON s2.id = p2."supplierId"
           WHERE sm2.type = 'COMPRA'
             AND TO_CHAR(sm2.date, 'YYYY-MM') = TO_CHAR(sm.date, 'YYYY-MM')
           GROUP BY s2.name
           ORDER BY SUM(sm2."totalCost") DESC LIMIT 1) as "topSupplier"
        FROM stock_movements sm
        WHERE sm.type = 'COMPRA' AND sm.date >= ${periodStart}
        GROUP BY TO_CHAR(sm.date, 'YYYY-MM')
        ORDER BY month ASC
      `

      return NextResponse.json({ groupBy: 'month', data })
    }

    return NextResponse.json({ error: 'groupBy inválido' }, { status: 400 })
  } catch (error: unknown) {
    console.error('Error in purchase analysis:', error)
    const message = error instanceof Error ? error.message : 'Error en análisis de compras'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

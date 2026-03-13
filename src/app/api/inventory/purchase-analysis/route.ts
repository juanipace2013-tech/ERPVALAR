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
    const groupBy = searchParams.get('groupBy') || 'product'
    const period = parseInt(searchParams.get('period') || '12')
    const supplierId = searchParams.get('supplierId')
    const productId = searchParams.get('productId')

    const periodStart = new Date()
    periodStart.setMonth(periodStart.getMonth() - period)

    if (groupBy === 'product') {
      // Group by productId using Prisma groupBy
      const grouped = await prisma.stockMovement.groupBy({
        by: ['productId'],
        where: {
          type: 'COMPRA',
          date: { gte: periodStart },
          ...(supplierId ? { product: { supplierId } } : {}),
          ...(productId ? { productId } : {}),
        },
        _sum: { quantity: true, totalCost: true },
        _count: { id: true },
        orderBy: { _sum: { totalCost: 'desc' } },
      })

      // Get distinct purchaseInvoiceId count per product and first/last unitCost
      const productIds = grouped.map(g => g.productId)
      const products = productIds.length > 0
        ? await prisma.product.findMany({
            where: { id: { in: productIds } },
            select: {
              id: true, sku: true, name: true, brand: true,
              supplier: { select: { name: true } },
            },
          })
        : []
      const productMap = new Map(products.map(p => [p.id, p]))

      // Get first and last price per product + supplier from purchaseInvoice as fallback
      const priceData = await Promise.all(
        productIds.map(async (pid) => {
          const [lastMove, firstMove, invoiceCount] = await Promise.all([
            prisma.stockMovement.findFirst({
              where: { productId: pid, type: 'COMPRA' },
              orderBy: { date: 'desc' },
              select: {
                unitCost: true,
                purchaseInvoice: { select: { supplier: { select: { name: true } } } },
              },
            }),
            prisma.stockMovement.findFirst({
              where: { productId: pid, type: 'COMPRA' },
              orderBy: { date: 'asc' },
              select: { unitCost: true },
            }),
            prisma.stockMovement.groupBy({
              by: ['purchaseInvoiceId'],
              where: { productId: pid, type: 'COMPRA', date: { gte: periodStart }, purchaseInvoiceId: { not: null } },
            }),
          ])
          return {
            productId: pid,
            lastPrice: Number(lastMove?.unitCost || 0),
            firstPrice: Number(firstMove?.unitCost || 0),
            invoiceCount: invoiceCount.length,
            invoiceSupplierName: lastMove?.purchaseInvoice?.supplier?.name || null,
          }
        })
      )
      const priceMap = new Map(priceData.map(p => [p.productId, p]))

      const data = grouped.map(g => {
        const prod = productMap.get(g.productId)
        const prices = priceMap.get(g.productId)
        const lastPrice = prices?.lastPrice || 0
        const firstPrice = prices?.firstPrice || 0
        return {
          productId: g.productId,
          sku: prod?.sku || '',
          name: prod?.name || '',
          brand: prod?.brand || null,
          supplierName: prod?.supplier?.name || prices?.invoiceSupplierName || null,
          totalQty: g._sum.quantity || 0,
          totalValue: Number(g._sum.totalCost || 0),
          invoiceCount: prices?.invoiceCount || 0,
          lastPrice,
          firstPrice,
          priceVariation: firstPrice > 0
            ? Math.round(((lastPrice - firstPrice) / firstPrice) * 10000) / 100
            : 0,
        }
      })

      return NextResponse.json({ groupBy: 'product', data })
    }

    if (groupBy === 'supplier') {
      // Get all purchase movements with supplier from purchaseInvoice (primary) and product (fallback)
      const movements = await prisma.stockMovement.findMany({
        where: {
          type: 'COMPRA',
          date: { gte: periodStart },
          ...(supplierId ? {
            OR: [
              { purchaseInvoice: { supplierId } },
              { product: { supplierId } },
            ],
          } : {}),
        },
        select: {
          quantity: true,
          totalCost: true,
          purchaseInvoiceId: true,
          purchaseInvoice: {
            select: { supplier: { select: { id: true, name: true } } },
          },
          product: {
            select: {
              name: true,
              supplier: { select: { id: true, name: true } },
            },
          },
        },
      })

      // Group by supplier in JS — use purchaseInvoice.supplier first, fallback to product.supplier
      const supplierMap = new Map<string, {
        name: string;
        totalItems: number;
        totalValue: number;
        invoiceIds: Set<string>;
        productTotals: Map<string, number>;
      }>()

      for (const m of movements) {
        const sid = m.purchaseInvoice?.supplier?.id || m.product.supplier?.id
        const sname = m.purchaseInvoice?.supplier?.name || m.product.supplier?.name
        if (!sid || !sname) continue

        const entry = supplierMap.get(sid) || {
          name: sname,
          totalItems: 0,
          totalValue: 0,
          invoiceIds: new Set<string>(),
          productTotals: new Map<string, number>(),
        }
        entry.totalItems += m.quantity
        entry.totalValue += Number(m.totalCost || 0)
        if (m.purchaseInvoiceId) entry.invoiceIds.add(m.purchaseInvoiceId)

        const pName = m.product.name
        entry.productTotals.set(pName, (entry.productTotals.get(pName) || 0) + Number(m.totalCost || 0))

        supplierMap.set(sid, entry)
      }

      const data = Array.from(supplierMap.entries())
        .map(([sid, s]) => {
          // Top 5 products
          const topProducts = Array.from(s.productTotals.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, totalValue]) => ({ name, totalValue }))

          return {
            supplierId: sid,
            supplierName: s.name,
            totalItems: s.totalItems,
            totalValue: s.totalValue,
            invoiceCount: s.invoiceIds.size,
            topProducts,
          }
        })
        .sort((a, b) => b.totalValue - a.totalValue)

      return NextResponse.json({ groupBy: 'supplier', data })
    }

    if (groupBy === 'month') {
      // Get all purchase movements
      const movements = await prisma.stockMovement.findMany({
        where: {
          type: 'COMPRA',
          date: { gte: periodStart },
        },
        select: {
          date: true,
          quantity: true,
          totalCost: true,
          purchaseInvoiceId: true,
          purchaseInvoice: {
            select: { supplier: { select: { name: true } } },
          },
          product: {
            select: {
              supplier: { select: { name: true } },
            },
          },
        },
      })

      // Group by month in JS
      const monthMap = new Map<string, {
        totalValue: number;
        totalQty: number;
        invoiceIds: Set<string>;
        supplierTotals: Map<string, number>;
      }>()

      for (const m of movements) {
        const key = `${m.date.getFullYear()}-${String(m.date.getMonth() + 1).padStart(2, '0')}`
        const entry = monthMap.get(key) || {
          totalValue: 0,
          totalQty: 0,
          invoiceIds: new Set<string>(),
          supplierTotals: new Map<string, number>(),
        }
        entry.totalValue += Number(m.totalCost || 0)
        entry.totalQty += m.quantity
        if (m.purchaseInvoiceId) entry.invoiceIds.add(m.purchaseInvoiceId)

        const sname = m.purchaseInvoice?.supplier?.name || m.product.supplier?.name
        if (sname) {
          entry.supplierTotals.set(sname, (entry.supplierTotals.get(sname) || 0) + Number(m.totalCost || 0))
        }

        monthMap.set(key, entry)
      }

      const data = Array.from(monthMap.entries())
        .map(([month, d]) => {
          // Find top supplier for this month
          let topSupplier: string | null = null
          let maxVal = 0
          for (const [name, val] of d.supplierTotals) {
            if (val > maxVal) { maxVal = val; topSupplier = name }
          }
          return {
            month,
            totalValue: d.totalValue,
            totalQty: d.totalQty,
            invoiceCount: d.invoiceIds.size,
            topSupplier,
          }
        })
        .sort((a, b) => a.month.localeCompare(b.month))

      return NextResponse.json({ groupBy: 'month', data })
    }

    return NextResponse.json({ error: 'groupBy inválido' }, { status: 400 })
  } catch (error: unknown) {
    console.error('Error in purchase analysis:', error)
    const message = error instanceof Error ? error.message : 'Error en análisis de compras'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

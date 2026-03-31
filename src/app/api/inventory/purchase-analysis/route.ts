import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

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
      // 1. Group by productId
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
        take: 200, // Limitar para no explotar
      })

      const productIds = grouped.map(g => g.productId)
      if (productIds.length === 0) {
        return NextResponse.json({ groupBy: 'product', data: [] })
      }

      // 2. Batch: productos con supplier (1 query)
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true, sku: true, name: true, brand: true,
          supplier: { select: { name: true } },
        },
      })
      const productMap = new Map(products.map(p => [p.id, p]))

      // 3. Batch: todos los movimientos COMPRA de estos productos para calcular
      //    first/last price e invoiceCount — UNA sola query en vez de N×3
      const allMovements = await prisma.stockMovement.findMany({
        where: {
          productId: { in: productIds },
          type: 'COMPRA',
        },
        select: {
          productId: true,
          unitCost: true,
          date: true,
          purchaseInvoiceId: true,
          purchaseInvoice: { select: { supplier: { select: { name: true } } } },
        },
        orderBy: { date: 'asc' },
      })

      // Procesar en JS: first/last price, invoice count por producto
      const priceMap = new Map<string, {
        lastPrice: number
        firstPrice: number
        invoiceCount: number
        invoiceSupplierName: string | null
      }>()

      for (const m of allMovements) {
        const existing = priceMap.get(m.productId)
        const cost = Number(m.unitCost || 0)

        if (!existing) {
          // Primer movimiento de este producto (ordenado por date asc)
          priceMap.set(m.productId, {
            firstPrice: cost,
            lastPrice: cost,
            invoiceCount: 0,
            invoiceSupplierName: m.purchaseInvoice?.supplier?.name || null,
          })
        } else {
          // Actualizar último precio (como está ordenado asc, el último que vemos es el más reciente)
          existing.lastPrice = cost
          existing.invoiceSupplierName = m.purchaseInvoice?.supplier?.name || existing.invoiceSupplierName
        }
      }

      // Contar facturas distintas por producto (solo en el período)
      const invoiceCountMap = new Map<string, Set<string>>()
      for (const m of allMovements) {
        if (m.purchaseInvoiceId && m.date >= periodStart) {
          const set = invoiceCountMap.get(m.productId) || new Set()
          set.add(m.purchaseInvoiceId)
          invoiceCountMap.set(m.productId, set)
        }
      }
      for (const [pid, set] of invoiceCountMap) {
        const existing = priceMap.get(pid)
        if (existing) existing.invoiceCount = set.size
      }

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
    logger.error('Error in purchase analysis:', error)
    const message = error instanceof Error ? error.message : 'Error en análisis de compras'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

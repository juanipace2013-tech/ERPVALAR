import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/facturacion/analisis
 * Retorna datos de facturación con filtros para el módulo de análisis:
 * - Listado de facturas filtradas
 * - Totales y resumen
 * - Datos para gráficos (mensual, por vendedor, top clientes, top productos, por marca)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const salesPersonId = searchParams.get('salesPersonId')
    const search = searchParams.get('search')
    const brand = searchParams.get('brand')
    const status = searchParams.get('status')

    // Construir filtro base
    const where: Record<string, unknown> = {
      transactionType: 'SALE',
    }

    if (dateFrom || dateTo) {
      const dateFilter: Record<string, Date> = {}
      if (dateFrom) dateFilter.gte = new Date(dateFrom)
      if (dateTo) {
        const endDate = new Date(dateTo)
        endDate.setHours(23, 59, 59, 999)
        dateFilter.lte = endDate
      }
      where.issueDate = dateFilter
    }

    if (salesPersonId) {
      where.userId = salesPersonId
    }

    if (status && status !== 'ALL') {
      where.status = status
    }

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ]
    }

    // Si filtro por marca, filtrar facturas que tengan items con esa marca (via producto)
    if (brand) {
      where.items = {
        some: {
          product: { brand: { equals: brand, mode: 'insensitive' } },
        },
      }
    }

    // 1. Obtener facturas filtradas
    const invoices = await prisma.invoice.findMany({
      where,
      select: {
        id: true,
        invoiceNumber: true,
        invoiceType: true,
        issueDate: true,
        dueDate: true,
        status: true,
        paymentStatus: true,
        currency: true,
        exchangeRate: true,
        subtotal: true,
        taxAmount: true,
        discount: true,
        total: true,
        customer: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
        items: {
          select: {
            id: true,
            description: true,
            quantity: true,
            unitPrice: true,
            subtotal: true,
            productId: true,
            product: { select: { id: true, name: true, sku: true, brand: true } },
          },
        },
      },
      orderBy: { issueDate: 'desc' },
    })

    // 2. Calcular totales
    let totalUSD = 0
    let totalARS = 0
    let totalFacturas = invoices.length

    for (const inv of invoices) {
      const total = Number(inv.total)
      if (inv.currency === 'USD') {
        totalUSD += total
        totalARS += total * Number(inv.exchangeRate || 1)
      } else {
        totalARS += total
      }
    }

    const ticketPromedio = totalFacturas > 0 ? totalUSD / totalFacturas : 0

    // 3. Comparación vs mes anterior
    const now = new Date()
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)

    const [currentMonthInvoices, prevMonthInvoices] = await Promise.all([
      prisma.invoice.findMany({
        where: { transactionType: 'SALE', issueDate: { gte: currentMonthStart } },
        select: { total: true, currency: true, exchangeRate: true },
      }),
      prisma.invoice.findMany({
        where: { transactionType: 'SALE', issueDate: { gte: prevMonthStart, lte: prevMonthEnd } },
        select: { total: true, currency: true, exchangeRate: true },
      }),
    ])

    const currentMonthTotal = currentMonthInvoices.reduce((sum, inv) => {
      return sum + (inv.currency === 'USD' ? Number(inv.total) : Number(inv.total) / Number(inv.exchangeRate || 1))
    }, 0)

    const prevMonthTotal = prevMonthInvoices.reduce((sum, inv) => {
      return sum + (inv.currency === 'USD' ? Number(inv.total) : Number(inv.total) / Number(inv.exchangeRate || 1))
    }, 0)

    const variacionMesAnterior = prevMonthTotal > 0
      ? ((currentMonthTotal - prevMonthTotal) / prevMonthTotal) * 100
      : 0

    // 4. Facturación mensual (últimos 12 meses)
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    const monthlyInvoices = await prisma.invoice.findMany({
      where: { transactionType: 'SALE', issueDate: { gte: twelveMonthsAgo } },
      select: { total: true, currency: true, exchangeRate: true, issueDate: true },
    })

    const monthlyData: Record<string, number> = {}
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthlyData[key] = 0
    }

    for (const inv of monthlyInvoices) {
      const d = new Date(inv.issueDate)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (monthlyData[key] !== undefined) {
        monthlyData[key] += inv.currency === 'USD'
          ? Number(inv.total)
          : Number(inv.total) / Number(inv.exchangeRate || 1)
      }
    }

    const facturacionMensual = Object.entries(monthlyData).map(([month, total]) => ({
      month,
      label: new Date(month + '-01').toLocaleDateString('es-AR', { month: 'short', year: '2-digit' }),
      total: Math.round(total * 100) / 100,
    }))

    // 5. Facturación por vendedor (desde facturas filtradas)
    const porVendedor: Record<string, { name: string; total: number }> = {}
    for (const inv of invoices) {
      const key = inv.user.id
      if (!porVendedor[key]) {
        porVendedor[key] = { name: inv.user.name, total: 0 }
      }
      porVendedor[key].total += inv.currency === 'USD'
        ? Number(inv.total)
        : Number(inv.total) / Number(inv.exchangeRate || 1)
    }
    const facturacionPorVendedor = Object.values(porVendedor)
      .sort((a, b) => b.total - a.total)
      .map((v) => ({ ...v, total: Math.round(v.total * 100) / 100 }))

    // 6. Top 10 clientes
    const porCliente: Record<string, { name: string; total: number }> = {}
    for (const inv of invoices) {
      const key = inv.customer.id
      if (!porCliente[key]) {
        porCliente[key] = { name: inv.customer.name, total: 0 }
      }
      porCliente[key].total += inv.currency === 'USD'
        ? Number(inv.total)
        : Number(inv.total) / Number(inv.exchangeRate || 1)
    }
    const topClientes = Object.values(porCliente)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map((c) => ({ ...c, total: Math.round(c.total * 100) / 100 }))

    // 7. Top 10 productos
    const porProducto: Record<string, { name: string; total: number; qty: number }> = {}
    for (const inv of invoices) {
      const rate = inv.currency === 'USD' ? 1 : 1 / Number(inv.exchangeRate || 1)
      for (const item of inv.items) {
        const key = item.productId || item.description || 'sin-producto'
        const name = item.product?.name || item.description || item.product?.sku || 'Sin nombre'
        if (!porProducto[key]) {
          porProducto[key] = { name, total: 0, qty: 0 }
        }
        porProducto[key].total += Number(item.subtotal) * rate
        porProducto[key].qty += Number(item.quantity)
      }
    }
    const topProductos = Object.values(porProducto)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map((p) => ({ ...p, total: Math.round(p.total * 100) / 100 }))

    // 8. Facturación por marca
    const porMarca: Record<string, number> = {}
    for (const inv of invoices) {
      const rate = inv.currency === 'USD' ? 1 : 1 / Number(inv.exchangeRate || 1)
      for (const item of inv.items) {
        const brandName = item.product?.brand || 'Sin marca'
        if (!porMarca[brandName]) porMarca[brandName] = 0
        porMarca[brandName] += Number(item.subtotal) * rate
      }
    }
    const facturacionPorMarca = Object.entries(porMarca)
      .sort(([, a], [, b]) => b - a)
      .map(([name, total]) => ({ name, total: Math.round(total * 100) / 100 }))

    // 9. Obtener marcas únicas para el filtro
    const marcasResult = await prisma.product.findMany({
      where: { brand: { not: null } },
      select: { brand: true },
      distinct: ['brand'],
      orderBy: { brand: 'asc' },
    })
    const marcas = marcasResult.map((m) => m.brand).filter(Boolean) as string[]

    return NextResponse.json({
      invoices: invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceType: inv.invoiceType,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        customer: inv.customer,
        salesPerson: inv.user,
        status: inv.status,
        paymentStatus: inv.paymentStatus,
        currency: inv.currency,
        exchangeRate: inv.exchangeRate,
        subtotal: inv.subtotal,
        taxAmount: inv.taxAmount,
        discount: inv.discount,
        total: inv.total,
        colppyId: null, // disponible después de prisma db push
      })),
      resumen: {
        totalUSD: Math.round(totalUSD * 100) / 100,
        totalARS: Math.round(totalARS * 100) / 100,
        totalFacturas,
        ticketPromedio: Math.round(ticketPromedio * 100) / 100,
        variacionMesAnterior: Math.round(variacionMesAnterior * 10) / 10,
      },
      graficos: {
        facturacionMensual,
        facturacionPorVendedor,
        topClientes,
        topProductos,
        facturacionPorMarca,
      },
      marcas,
    })
  } catch (error) {
    console.error('Error en análisis de facturación:', error)
    return NextResponse.json(
      { error: 'Error al obtener análisis de facturación' },
      { status: 500 }
    )
  }
}

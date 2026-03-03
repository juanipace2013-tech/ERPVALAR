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

    // Construir filtro base: FAV (SALE), NDV (DEBIT_NOTE) y NCV (CREDIT_NOTE)
    const where: Record<string, unknown> = {
      transactionType: { in: ['SALE', 'CREDIT_NOTE', 'DEBIT_NOTE'] },
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
        transactionType: true,
        notes: true,
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
        colppyId: true,
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

    // 2. Calcular totales separados por moneda + totales generales en USD y ARS
    // IMPORTANTE: NC se RESTAN, ND se SUMAN, FAV se SUMAN
    let totalUSD = 0        // Solo facturas en USD (sumadas en USD)
    let totalARS = 0        // Solo facturas en ARS (sumadas en ARS)
    let totalGeneralUSD = 0 // Todo convertido a USD
    let totalGeneralARS = 0 // Todo convertido a ARS
    let totalCreditNotesUSD = 0
    let totalCreditNotesARS = 0
    const totalFacturas = invoices.length
    const totalNC = invoices.filter(inv => inv.transactionType === 'CREDIT_NOTE').length

    for (const inv of invoices) {
      const total = Number(inv.total)
      const esNC = inv.transactionType === 'CREDIT_NOTE'
      // NC restan (-1), FAV y NDV suman (+1)
      const signo = esNC ? -1 : 1
      const tc = Number(inv.exchangeRate || 0)

      if (inv.currency === 'USD') {
        totalUSD += total * signo
        totalGeneralUSD += total * signo
        // Para totalGeneralARS: USD × TC
        const totalEnARS = tc > 1 ? total * tc : total * 1420
        totalGeneralARS += totalEnARS * signo
        if (esNC) totalCreditNotesUSD += total
      } else {
        totalARS += total * signo
        // Para totalGeneralUSD: ARS / TC
        const totalEnUSD = tc > 1 ? total / tc : 0
        totalGeneralUSD += totalEnUSD * signo
        // Para totalGeneralARS: usar total ARS tal cual
        totalGeneralARS += total * signo
        if (esNC) totalCreditNotesARS += total
      }
    }

    // Ticket promedio: totalGeneralUSD / cantidad de SALE solamente (sin NC ni ND)
    const totalSaleOnly = invoices.filter(inv => inv.transactionType === 'SALE').length
    const ticketPromedio = totalSaleOnly > 0 ? totalGeneralUSD / totalSaleOnly : 0

    // 3. Comparación vs mes anterior
    const now = new Date()
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)

    const [currentMonthInvoices, prevMonthInvoices] = await Promise.all([
      prisma.invoice.findMany({
        where: { transactionType: { in: ['SALE', 'CREDIT_NOTE', 'DEBIT_NOTE'] }, issueDate: { gte: currentMonthStart } },
        select: { total: true, currency: true, exchangeRate: true, transactionType: true },
      }),
      prisma.invoice.findMany({
        where: { transactionType: { in: ['SALE', 'CREDIT_NOTE', 'DEBIT_NOTE'] }, issueDate: { gte: prevMonthStart, lte: prevMonthEnd } },
        select: { total: true, currency: true, exchangeRate: true, transactionType: true },
      }),
    ])

    const toUSD = (inv: { total: unknown; currency: string; exchangeRate: unknown; transactionType: string }) => {
      const total = Number(inv.total)
      const signo = inv.transactionType === 'CREDIT_NOTE' ? -1 : 1
      if (inv.currency === 'USD') return total * signo
      const tc = Number(inv.exchangeRate || 0)
      return tc > 1 ? (total / tc) * signo : 0
    }

    const currentMonthTotal = currentMonthInvoices.reduce((sum, inv) => sum + toUSD(inv), 0)
    const prevMonthTotal = prevMonthInvoices.reduce((sum, inv) => sum + toUSD(inv), 0)

    const variacionMesAnterior = prevMonthTotal > 0
      ? ((currentMonthTotal - prevMonthTotal) / prevMonthTotal) * 100
      : 0

    // 4. Facturación mensual (año calendario actual: Ene-Dic)
    const currentYear = now.getFullYear()
    const yearStart = new Date(currentYear, 0, 1) // 1 de Enero del año actual
    const monthlyInvoices = await prisma.invoice.findMany({
      where: { transactionType: { in: ['SALE', 'CREDIT_NOTE', 'DEBIT_NOTE'] }, issueDate: { gte: yearStart } },
      select: { total: true, currency: true, exchangeRate: true, issueDate: true, transactionType: true },
    })

    // Generar 12 meses del año actual (Ene-Dic)
    const monthlyData: Record<string, number> = {}
    for (let m = 0; m < 12; m++) {
      const key = `${currentYear}-${String(m + 1).padStart(2, '0')}`
      monthlyData[key] = 0
    }

    for (const inv of monthlyInvoices) {
      const d = new Date(inv.issueDate)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (monthlyData[key] !== undefined) {
        monthlyData[key] += toUSD(inv as typeof monthlyInvoices[0])
      }
    }

    // Labels manuales para evitar desfase por timezone (new Date('2026-01-01') = dic en UTC-3)
    const monthNames = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
    const facturacionMensual = Object.entries(monthlyData).map(([month, total]) => {
      const [y, m] = month.split('-').map(Number)
      return {
        month,
        label: `${monthNames[m - 1]} ${String(y).slice(2)}`,
        total: Math.round(total * 100) / 100,
      }
    })

    // 5. Facturación por vendedor (desde facturas filtradas, NC restan)
    const porVendedor: Record<string, { name: string; total: number }> = {}
    for (const inv of invoices) {
      const key = inv.user.id
      if (!porVendedor[key]) {
        porVendedor[key] = { name: inv.user.name, total: 0 }
      }
      porVendedor[key].total += toUSD(inv as Parameters<typeof toUSD>[0])
    }
    const facturacionPorVendedor = Object.values(porVendedor)
      .sort((a, b) => b.total - a.total)
      .map((v) => ({ ...v, total: Math.round(v.total * 100) / 100 }))

    // 6. Top 10 clientes (NC restan)
    const porCliente: Record<string, { name: string; total: number }> = {}
    for (const inv of invoices) {
      const key = inv.customer.id
      if (!porCliente[key]) {
        porCliente[key] = { name: inv.customer.name, total: 0 }
      }
      porCliente[key].total += toUSD(inv as Parameters<typeof toUSD>[0])
    }
    const topClientes = Object.values(porCliente)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map((c) => ({ ...c, total: Math.round(c.total * 100) / 100 }))

    // 7. Top 10 productos (NC restan)
    const porProducto: Record<string, { name: string; total: number; qty: number }> = {}
    for (const inv of invoices) {
      // Items ya están en la moneda original de la factura
      const rate = inv.currency === 'USD' ? 1 : (Number(inv.exchangeRate || 0) > 1 ? 1 / Number(inv.exchangeRate) : 0)
      const signo = inv.transactionType === 'CREDIT_NOTE' ? -1 : 1
      for (const item of inv.items) {
        const key = item.productId || item.description || 'sin-producto'
        const name = item.product?.name || item.description || item.product?.sku || 'Sin nombre'
        if (!porProducto[key]) {
          porProducto[key] = { name, total: 0, qty: 0 }
        }
        porProducto[key].total += Number(item.subtotal) * rate * signo
        porProducto[key].qty += Number(item.quantity) * signo
      }
    }
    const topProductos = Object.values(porProducto)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map((p) => ({ ...p, total: Math.round(p.total * 100) / 100 }))

    // 8. Facturación por marca (NC restan)
    const porMarca: Record<string, number> = {}
    for (const inv of invoices) {
      const rate = inv.currency === 'USD' ? 1 : (Number(inv.exchangeRate || 0) > 1 ? 1 / Number(inv.exchangeRate) : 0)
      const signo = inv.transactionType === 'CREDIT_NOTE' ? -1 : 1
      for (const item of inv.items) {
        const brandName = item.product?.brand || 'Sin marca'
        if (!porMarca[brandName]) porMarca[brandName] = 0
        porMarca[brandName] += Number(item.subtotal) * rate * signo
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
      invoices: invoices.map((inv) => {
        // Extraer label del comprobante del campo notes: "FAV A - ..." → "FAV-A"
        const noteParts = (inv.notes || '').split(' - ')
        const compLabelRaw = noteParts[0] || ''
        const compParts = compLabelRaw.split(' ')
        const comprobanteLabel = compParts.length >= 2 ? `${compParts[0]}-${compParts[1]}` : compLabelRaw

        return {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceType: inv.invoiceType,
          transactionType: inv.transactionType,
          comprobanteLabel,
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
          colppyId: inv.colppyId,
        }
      }),
      resumen: {
        totalUSD: Math.round(totalUSD * 100) / 100,
        totalARS: Math.round(totalARS * 100) / 100,
        totalGeneralUSD: Math.round(totalGeneralUSD * 100) / 100,
        totalGeneralARS: Math.round(totalGeneralARS * 100) / 100,
        totalFacturas,
        totalNC,
        totalCreditNotesUSD: Math.round(totalCreditNotesUSD * 100) / 100,
        totalCreditNotesARS: Math.round(totalCreditNotesARS * 100) / 100,
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

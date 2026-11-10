import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import type { InvoiceStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

const TIPOS_VENTA: Prisma.InvoiceWhereInput = {
  transactionType: { in: ['SALE', 'CREDIT_NOTE', 'DEBIT_NOTE'] },
}

// Solo si la tabla de cotizaciones estuviera vacía (no debería: el cron BNA carga a diario)
const TC_ULTIMO_RECURSO = 1420

const round2 =(n: number) => Math.round(n * 100) / 100

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
    const where: Prisma.InvoiceWhereInput = { ...TIPOS_VENTA }

    if (dateFrom || dateTo) {
      const dateFilter: Prisma.DateTimeFilter = {}
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
      where.status = status as InvoiceStatus
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

    // Serie del año + mes anterior: no depende de los filtros. Una sola consulta
    // cubre el gráfico mensual y la variación vs mes anterior (en enero el mes
    // anterior cae en el año pasado, por eso se toma la fecha más vieja).
    const now = new Date()
    const currentYear = now.getFullYear()
    const yearStart = new Date(currentYear, 0, 1)
    const currentMonthStart = new Date(currentYear, now.getMonth(), 1)
    const prevMonthStart = new Date(currentYear, now.getMonth() - 1, 1)
    const serieDesde = prevMonthStart < yearStart ? prevMonthStart : yearStart
    // La variación compara el mes en curso contra los MISMOS días del mes
    // anterior (del 1 al día de hoy): contra el mes completo, cualquier mes
    // daba muy negativo hasta sus últimos días.
    const diasMesAnterior = new Date(currentYear, now.getMonth(), 0).getDate()
    const prevMonthCorte = new Date(
      currentYear, now.getMonth() - 1, Math.min(now.getDate(), diasMesAnterior), 23, 59, 59, 999
    )

    // Todas las consultas en paralelo: antes eran 5 viajes en serie a la base, y
    // los ítems venían anidados dentro de cada factura.
    const [invoices, items, serie, marcasResult, cotizaciones] = await Promise.all([
      prisma.invoice.findMany({
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
        },
        orderBy: { issueDate: 'desc' },
      }),
      prisma.invoiceItem.findMany({
        where: { invoice: where },
        select: {
          invoiceId: true,
          productId: true,
          description: true,
          quantity: true,
          subtotal: true,
          product: { select: { name: true, sku: true, brand: true } },
        },
      }),
      prisma.invoice.findMany({
        where: { ...TIPOS_VENTA, issueDate: { gte: serieDesde } },
        select: { total: true, currency: true, exchangeRate: true, issueDate: true, transactionType: true },
      }),
      prisma.product.findMany({
        where: { brand: { not: null } },
        select: { brand: true },
        distinct: ['brand'],
        orderBy: { brand: 'asc' },
      }),
      // Cotizaciones USD→ARS cargadas (BNA y manuales), para las facturas que
      // quedaron sin TC propio: se convierten al TC de su fecha
      prisma.exchangeRate.findMany({
        where: { fromCurrency: 'USD', toCurrency: 'ARS' },
        select: { rate: true, validFrom: true },
        orderBy: { validFrom: 'asc' },
      }),
    ])

    const tcs = cotizaciones.map((c) => ({ desde: c.validFrom.getTime(), rate: Number(c.rate) }))
    /** TC vigente a una fecha: la última cotización cargada hasta ese día (o la primera que haya). */
    const tcALaFecha = (fecha: Date) => {
      if (tcs.length === 0) return TC_ULTIMO_RECURSO
      const t = fecha.getTime()
      let lo = 0
      let hi = tcs.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (tcs[mid].desde <= t) lo = mid
        else hi = mid - 1
      }
      return tcs[lo].rate
    }
    /** TC del comprobante: el propio y, si no lo tiene, el de la fecha de la factura. */
    const tcDe = (inv: { exchangeRate: unknown; issueDate: Date }) => {
      const tc = Number(inv.exchangeRate || 0)
      return tc > 1 ? tc : tcALaFecha(inv.issueDate)
    }
    /** Total del comprobante en USD con signo (las NC restan). */
    const toUSD = (inv: { total: unknown; currency: string; exchangeRate: unknown; issueDate: Date; transactionType: string }) => {
      const signo = inv.transactionType === 'CREDIT_NOTE' ? -1 : 1
      const total = Number(inv.total) * signo
      return inv.currency === 'USD' ? total : total / tcDe(inv)
    }

    // Totales separados por moneda + generales en USD y ARS, por vendedor y por
    // cliente, en una sola pasada. NC se RESTAN; ND y FAV se SUMAN.
    let totalUSD = 0        // Solo facturas en USD (sumadas en USD)
    let totalARS = 0        // Solo facturas en ARS (sumadas en ARS)
    let totalGeneralUSD = 0 // Todo convertido a USD
    let totalGeneralARS = 0 // Todo convertido a ARS
    let totalCreditNotesUSD = 0
    let totalCreditNotesARS = 0
    let totalNC = 0
    let totalSaleOnly = 0
    const porVendedor: Record<string, { name: string; total: number }> = {}
    const porCliente: Record<string, { name: string; total: number }> = {}
    // Factor por factura para llevar sus ítems a USD con signo
    const factorItems = new Map<string, { rate: number; signo: number }>()
    // TC usado para cada comprobante (va al listado: la pantalla rehace el
    // gráfico por vendedor con el mismo TC al reasignar)
    const tcAplicado = new Map<string, number>()

    for (const inv of invoices) {
      const total = Number(inv.total)
      const esNC = inv.transactionType === 'CREDIT_NOTE'
      const signo = esNC ? -1 : 1
      const tc = tcDe(inv)
      const enUSD = toUSD(inv)
      tcAplicado.set(inv.id, tc)

      if (esNC) totalNC++
      if (inv.transactionType === 'SALE') totalSaleOnly++

      totalGeneralUSD += enUSD
      if (inv.currency === 'USD') {
        totalUSD += total * signo
        // Para totalGeneralARS: USD × TC
        totalGeneralARS += total * tc * signo
        if (esNC) totalCreditNotesUSD += total
      } else {
        totalARS += total * signo
        totalGeneralARS += total * signo
        if (esNC) totalCreditNotesARS += total
      }

      const vendedor = (porVendedor[inv.user.id] ??= { name: inv.user.name, total: 0 })
      vendedor.total += enUSD
      const cliente = (porCliente[inv.customer.id] ??= { name: inv.customer.name, total: 0 })
      cliente.total += enUSD

      // Los ítems están en la moneda original de la factura
      factorItems.set(inv.id, {
        rate: inv.currency === 'USD' ? 1 : 1 / tc,
        signo,
      })
    }

    // Ticket promedio: totalGeneralUSD / cantidad de SALE solamente (sin NC ni ND)
    const ticketPromedio = totalSaleOnly > 0 ? totalGeneralUSD / totalSaleOnly : 0

    const facturacionPorVendedor = Object.values(porVendedor)
      .sort((a, b) => b.total - a.total)
      .map((v) => ({ ...v, total: round2(v.total) }))

    const topClientes = Object.values(porCliente)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map((c) => ({ ...c, total: round2(c.total) }))

    // Top productos y facturación por marca (NC restan)
    const porProducto: Record<string, { name: string; sku: string | null; total: number; qty: number }> = {}
    const porMarca: Record<string, number> = {}
    for (const item of items) {
      const factor = factorItems.get(item.invoiceId)
      if (!factor) continue
      const enUSD = Number(item.subtotal) * factor.rate * factor.signo

      const key = item.productId || item.description || 'sin-producto'
      const producto = (porProducto[key] ??= {
        name: item.product?.name || item.description || item.product?.sku || 'Sin nombre',
        sku: item.product?.sku ?? null,
        total: 0,
        qty: 0,
      })
      producto.total += enUSD
      producto.qty += Number(item.quantity) * factor.signo

      const brandName = item.product?.brand || 'Sin marca'
      porMarca[brandName] = (porMarca[brandName] ?? 0) + enUSD
    }

    const topProductos = Object.values(porProducto)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map((p) => ({ ...p, total: round2(p.total) }))

    const facturacionPorMarca = Object.entries(porMarca)
      .sort(([, a], [, b]) => b - a)
      .map(([name, total]) => ({ name, total: round2(total) }))

    // Facturación mensual (año calendario actual: Ene-Dic) y variación vs mes anterior
    const monthlyData: Record<string, number> = {}
    for (let m = 0; m < 12; m++) {
      monthlyData[`${currentYear}-${String(m + 1).padStart(2, '0')}`] = 0
    }
    let currentMonthTotal = 0
    let prevMonthTotal = 0

    for (const inv of serie) {
      const d = new Date(inv.issueDate)
      const enUSD = toUSD(inv)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (monthlyData[key] !== undefined) monthlyData[key] += enUSD
      if (d >= currentMonthStart) currentMonthTotal += enUSD
      else if (d >= prevMonthStart && d <= prevMonthCorte) prevMonthTotal += enUSD
    }

    const variacionMesAnterior = prevMonthTotal > 0
      ? ((currentMonthTotal - prevMonthTotal) / prevMonthTotal) * 100
      : 0

    // Labels manuales para evitar desfase por timezone (new Date('2026-01-01') = dic en UTC-3)
    const monthNames = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
    const facturacionMensual = Object.entries(monthlyData).map(([month, total]) => {
      const [y, m] = month.split('-').map(Number)
      return {
        month,
        label: `${monthNames[m - 1]} ${String(y).slice(2)}`,
        total: round2(total),
      }
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
          tcAplicado: tcAplicado.get(inv.id),
          subtotal: inv.subtotal,
          taxAmount: inv.taxAmount,
          discount: inv.discount,
          total: inv.total,
          colppyId: inv.colppyId,
        }
      }),
      resumen: {
        totalUSD: round2(totalUSD),
        totalARS: round2(totalARS),
        totalGeneralUSD: round2(totalGeneralUSD),
        totalGeneralARS: round2(totalGeneralARS),
        totalFacturas: invoices.length,
        totalNC,
        totalCreditNotesUSD: round2(totalCreditNotesUSD),
        totalCreditNotesARS: round2(totalCreditNotesARS),
        ticketPromedio: round2(ticketPromedio),
        variacionMesAnterior: Math.round(variacionMesAnterior * 10) / 10,
        variacionHastaDia: now.getDate(),
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
    logger.error('Error en análisis de facturación:', error)
    return NextResponse.json(
      { error: 'Error al obtener análisis de facturación' },
      { status: 500 }
    )
  }
}

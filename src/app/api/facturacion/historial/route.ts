import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

/**
 * GET /api/facturacion/historial
 * Devuelve el historial de cotizaciones enviadas a Colppy (colppySyncedAt != null).
 * Soporta paginación (20 por página) y filtros por vendedor, cliente, fechas.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const vendedorId = searchParams.get('vendedorId')
    const clienteId = searchParams.get('clienteId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const page = parseInt(searchParams.get('page') || '0', 10)
    const pageSize = 20

    // Filtro base: cotizaciones enviadas a Colppy
    const where: any = {
      colppySyncedAt: { not: null },
      ...(vendedorId && { salesPersonId: vendedorId }),
      ...(clienteId && { customerId: clienteId }),
      ...((dateFrom || dateTo) && {
        colppySyncedAt: {
          not: null,
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo + 'T23:59:59.999Z') }),
        },
      }),
    }

    // Contar total para paginación
    const [total, quotes] = await Promise.all([
      prisma.quote.count({ where }),
      prisma.quote.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, cuit: true } },
          salesPerson: { select: { id: true, name: true } },
        },
        orderBy: { colppySyncedAt: 'desc' },
        take: pageSize,
        skip: page * pageSize,
      }),
    ])

    // Formatear para el frontend
    const historial = quotes.map((q) => {
      const total = Number(q.total)
      const exchangeRate = q.exchangeRate ? Number(q.exchangeRate) : null

      return {
        id: q.id,
        date: q.colppySyncedAt!.toISOString(),
        colppyRef: q.colppyInvoiceId || '—',
        quoteNumber: q.quoteNumber,
        customer: q.customer,
        salesPerson: q.salesPerson,
        currency: q.currency,
        totalUSD: q.currency === 'USD' ? total : (exchangeRate ? total / exchangeRate : null),
        totalARS: q.currency === 'USD' ? (exchangeRate ? total * exchangeRate : null) : total,
        isFactura: !!q.colppyInvoiceId,
        isRemito: !!q.colppyDeliveryNoteId,
        status: q.status,
      }
    })

    // Obtener vendedores y clientes para filtros
    const [vendedores, clientes] = await Promise.all([
      prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'GERENTE', 'VENDEDOR'] } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.customer.findMany({
        where: {
          quotes: { some: { colppySyncedAt: { not: null } } },
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ])

    return NextResponse.json({
      historial,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      filters: { vendedores, clientes },
    })
  } catch (error) {
    logger.error('Error fetching facturacion historial:', error)
    return NextResponse.json(
      { error: 'Error al cargar historial de facturación' },
      { status: 500 }
    )
  }
}

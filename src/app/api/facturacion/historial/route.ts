import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/facturacion/historial
 * Devuelve el historial de facturas/remitos enviados a Colppy desde el tablero de facturación.
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

    // Buscar Invoices creadas desde el flujo de facturación (enviadas a Colppy)
    const invoices = await prisma.invoice.findMany({
      where: {
        transactionType: 'SALE',
        invoiceNumber: { startsWith: 'BORRADOR-COLPPY-' },
        ...(clienteId && { customerId: clienteId }),
        ...(vendedorId && { quote: { salesPersonId: vendedorId } }),
        ...((dateFrom || dateTo) && {
          createdAt: {
            ...(dateFrom && { gte: new Date(dateFrom) }),
            ...(dateTo && { lte: new Date(dateTo + 'T23:59:59.999Z') }),
          },
        }),
      },
      include: {
        customer: {
          select: { id: true, name: true, cuit: true },
        },
        quote: {
          select: {
            quoteNumber: true,
            currency: true,
            exchangeRate: true,
            salesPerson: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    // Formatear para el frontend
    const historial = invoices.map((inv) => {
      const total = Number(inv.total)
      const exchangeRate = inv.quote?.exchangeRate ? Number(inv.quote.exchangeRate) : null
      const currency = inv.quote?.currency || inv.currency

      // Extraer número de factura/remito del invoiceNumber
      const colppyRef = inv.invoiceNumber.replace('BORRADOR-COLPPY-', '')

      // Determinar si es factura o remito basado en las notes
      const isFactura = inv.notes?.includes('Factura:') || false
      const isRemito = inv.notes?.includes('Remito:') || false

      return {
        id: inv.id,
        date: inv.createdAt.toISOString(),
        colppyRef,
        quoteNumber: inv.quote?.quoteNumber || '—',
        customer: inv.customer,
        salesPerson: inv.quote?.salesPerson || null,
        currency,
        totalUSD: currency === 'USD' ? total : (exchangeRate ? total / exchangeRate : null),
        totalARS: currency === 'USD' ? (exchangeRate ? total * exchangeRate : null) : total,
        isFactura,
        isRemito,
        status: inv.status,
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
          invoices: {
            some: { invoiceNumber: { startsWith: 'BORRADOR-COLPPY-' } },
          },
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ])

    return NextResponse.json({
      historial,
      filters: { vendedores, clientes },
    })
  } catch (error) {
    console.error('Error fetching facturacion historial:', error)
    return NextResponse.json(
      { error: 'Error al cargar historial de facturación' },
      { status: 500 }
    )
  }
}

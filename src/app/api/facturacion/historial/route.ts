import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { VENDEDOR_SELECCIONABLE } from '@/lib/vendedores'

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
    const search = searchParams.get('search')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const page = parseInt(searchParams.get('page') || '0', 10)
    const pageSize = 20

    // Filtro base: cotizaciones enviadas a Colppy
    const where: any = {
      colppySyncedAt: { not: null },
      ...(vendedorId && { salesPersonId: vendedorId }),
      ...(clienteId && { customerId: clienteId }),
      ...(search && {
        OR: [
          { quoteNumber: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
          { purchaseOrderNumber: { contains: search, mode: 'insensitive' } },
        ],
      }),
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
          // Número fiscal de las facturas vigentes (A-0007-00000005), la última primero
          facturas: {
            where: { estado: { notIn: ['ANULADA', 'ERROR_GUARDADO', 'NOTA_CREDITO'] } },
            select: { numeroFactura: true, invoice: { select: { id: true, invoiceNumber: true } } },
            orderBy: { fecha: 'desc' },
          },
        },
        orderBy: { colppySyncedAt: 'desc' },
        take: pageSize,
        skip: page * pageSize,
      }),
    ])

    // Cotizaciones viejas sin envío (CotizacionFactura): la factura del ERP por id de Colppy
    const colppyIdsSinEnvio = quotes.filter((q) => !q.facturas.length && q.colppyInvoiceId).map((q) => q.colppyInvoiceId!)
    const facturasPorColppyId = new Map(
      (colppyIdsSinEnvio.length
        ? await prisma.invoice.findMany({
            where: { colppyId: { in: colppyIdsSinEnvio } },
            select: { id: true, colppyId: true, invoiceNumber: true },
          })
        : []
      ).map((i) => [i.colppyId!, i])
    )
    // A-0007-00000017, FCEA-0007-00000001, 0003-00015423 (no "BORRADOR-COLPPY-...")
    const esNumero = (n: string | null | undefined) => !!n && /^(?:[A-Z]{1,5}-)?\d{4,5}-\d{8}$/.test(n)

    // Formatear para el frontend
    const historial = quotes.map((q) => {
      const total = Number(q.total)
      const exchangeRate = q.exchangeRate ? Number(q.exchangeRate) : null
      // Número de factura real (el de la factura del ERP si está vinculada) y su
      // id para el link; si no hay (borradores viejos), el id de Colppy
      const envio = q.facturas.find((f) => esNumero(f.invoice?.invoiceNumber) || esNumero(f.numeroFactura))
      const viejaPorColppy = !q.facturas.length && q.colppyInvoiceId ? facturasPorColppyId.get(q.colppyInvoiceId) : undefined
      const numero = envio
        ? (esNumero(envio.invoice?.invoiceNumber) ? envio.invoice!.invoiceNumber : envio.numeroFactura)
        : esNumero(viejaPorColppy?.invoiceNumber)
          ? viejaPorColppy!.invoiceNumber
          : null

      return {
        id: q.id,
        date: q.colppySyncedAt!.toISOString(),
        colppyRef: numero || q.colppyInvoiceId || '—',
        // Factura del ERP para el link del número (null: no hay factura vinculada)
        facturaId: envio?.invoice?.id ?? viejaPorColppy?.id ?? null,
        facturasExtra: Math.max(0, q.facturas.length - 1),
        quoteNumber: q.quoteNumber,
        purchaseOrderNumber: q.purchaseOrderNumber,
        customer: q.customer,
        salesPerson: q.salesPerson,
        currency: q.currency,
        totalUSD: q.currency === 'USD' ? total : (exchangeRate ? total / exchangeRate : null),
        totalARS: q.currency === 'USD' ? (exchangeRate ? total * exchangeRate : null) : total,
        isFactura: !!q.colppyInvoiceId || q.facturas.length > 0,
        isRemito: !!q.colppyDeliveryNoteId,
        status: q.status,
      }
    })

    // Obtener vendedores y clientes para filtros
    const [vendedores, clientes] = await Promise.all([
      prisma.user.findMany({
        where: VENDEDOR_SELECCIONABLE,
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

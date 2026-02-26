import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  isItemInStock,
  classifyQuote,
  getFarthestDelivery,
  type KanbanColumn,
} from '@/lib/facturacion-utils'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const vendedorId = searchParams.get('vendedorId')
    const clienteId = searchParams.get('clienteId')
    const moneda = searchParams.get('moneda')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    // Buscar cotizaciones ACCEPTED (no CONVERTED ni CANCELLED)
    const quotes = await prisma.quote.findMany({
      where: {
        status: 'ACCEPTED',
        ...(vendedorId && { salesPersonId: vendedorId }),
        ...(clienteId && { customerId: clienteId }),
        ...(moneda && { currency: moneda as 'USD' | 'ARS' }),
        ...((dateFrom || dateTo) && {
          date: {
            ...(dateFrom && { gte: new Date(dateFrom) }),
            ...(dateTo && { lte: new Date(dateTo + 'T23:59:59.999Z') }),
          },
        }),
      },
      include: {
        customer: {
          select: { id: true, name: true, cuit: true, taxCondition: true, paymentTerms: true },
        },
        salesPerson: {
          select: { id: true, name: true },
        },
        items: {
          where: { isAlternative: false },
          include: {
            product: { select: { sku: true, name: true } },
            invoiceItems: {
              include: {
                invoice: { select: { status: true, notes: true, createdAt: true } },
              },
            },
          },
        },
      },
      orderBy: { date: 'desc' },
    })

    // Procesar cada cotización
    const boardCards = []

    for (const quote of quotes) {
      // Calcular cantidad facturada por ítem
      const processedItems = quote.items.map((item) => {
        const invoicedQuantity = item.invoiceItems
          .filter((ii) => ii.invoice.status !== 'CANCELLED')
          .reduce((sum, ii) => sum + ii.quantity, 0)

        const remainingQuantity = item.quantity - invoicedQuantity

        // Determinar si este ítem fue enviado a Colppy (tiene invoiceItems DRAFT)
        const sentToColppy = item.invoiceItems.some(
          (ii) => ii.invoice.status === 'DRAFT' && ii.invoice.notes?.includes('Colppy')
        )

        return {
          id: item.id,
          itemNumber: item.itemNumber,
          description: item.description || item.product?.name || 'Sin descripción',
          productSku: item.product?.sku || item.manualSku || null,
          quantity: item.quantity,
          invoicedQuantity,
          remainingQuantity,
          unitPrice: Number(item.unitPrice),
          totalPrice: Number(item.totalPrice),
          deliveryTime: item.deliveryTime,
          isInStock: isItemInStock(item.deliveryTime),
          isAlternative: item.isAlternative,
          sentToColppy,
        }
      })

      // Verificar si está completamente facturada
      const isFullyInvoiced = processedItems.every((item) => item.remainingQuantity <= 0)
      if (isFullyInvoiced) continue // No mostrar en el tablero

      // Clasificar
      const column = classifyQuote(
        quote.items.map((i) => ({
          deliveryTime: i.deliveryTime,
          isAlternative: i.isAlternative,
        }))
      )

      const readyItemsCount = processedItems.filter((i) => i.isInStock).length
      const totalItemsCount = processedItems.length

      // Determinar estado Colppy de la cotización
      const colppySyncedAt = quote.colppySyncedAt
        ? quote.colppySyncedAt.toISOString()
        : null
      const colppyInvoiceId = quote.colppyInvoiceId || null

      boardCards.push({
        id: quote.id,
        quoteNumber: quote.quoteNumber,
        customer: quote.customer,
        salesPerson: quote.salesPerson,
        currency: quote.currency,
        total: Number(quote.total),
        exchangeRate: Number(quote.exchangeRate),
        terms: quote.terms,
        notes: quote.notes,
        date: quote.date.toISOString(),
        readyItemsCount,
        totalItemsCount,
        farthestDelivery: getFarthestDelivery(
          quote.items.map((i) => ({
            deliveryTime: i.deliveryTime,
            isAlternative: i.isAlternative,
          }))
        ),
        items: processedItems,
        column,
        // Estado Colppy
        colppySyncedAt,
        colppyInvoiceId,
      })
    }

    // Agrupar por columna
    const columns: Record<KanbanColumn, typeof boardCards> = {
      ready: [],
      partial: [],
      pending: [],
    }

    for (const card of boardCards) {
      columns[card.column].push(card)
    }

    // Calcular totales por columna
    const computeColumnStats = (cards: typeof boardCards) => ({
      quotes: cards,
      count: cards.length,
      totalUSD: cards
        .filter((c) => c.currency === 'USD')
        .reduce((sum, c) => sum + c.total, 0),
      totalARS: cards
        .filter((c) => c.currency === 'ARS')
        .reduce((sum, c) => sum + c.total, 0),
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
          quotes: {
            some: { status: 'ACCEPTED' },
          },
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ])

    return NextResponse.json({
      columns: {
        ready: computeColumnStats(columns.ready),
        partial: computeColumnStats(columns.partial),
        pending: computeColumnStats(columns.pending),
      },
      filters: { vendedores, clientes },
    })
  } catch (error) {
    console.error('Error fetching facturacion board:', error)
    return NextResponse.json(
      { error: 'Error al cargar tablero de facturación' },
      { status: 500 }
    )
  }
}

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import {
  getFarthestDelivery,
  type KanbanColumn,
} from '@/lib/facturacion-utils'

/**
 * Indica si el deliveryTime del vendedor es inmediato.
 */
function isDeliveryImmediate(deliveryTime: string | null): boolean {
  if (!deliveryTime) return true // null/vacío = inmediato
  const normalized = deliveryTime.trim().toLowerCase()
  return normalized === 'inmediato' || normalized === 'inmediata' || normalized === 'stock'
}

/**
 * Determina si un item está listo para facturar.
 *
 * Reglas:
 * 1. Si hay producto vinculado con stockQuantity conocido → exigir stock >= remaining
 *    (el stock real siempre tiene prioridad sobre deliveryTime)
 * 2. Sin producto vinculado (item manual) → usar deliveryTime como señal
 */
function isItemReady(
  stockQuantity: number | null | undefined,
  remainingQuantity: number,
  deliveryTime: string | null,
  hasProduct: boolean
): boolean {
  // Producto vinculado con stock conocido → comparar stock real vs cantidad
  if (hasProduct && stockQuantity != null) {
    return stockQuantity >= remainingQuantity
  }
  // Item manual sin producto → confiar en deliveryTime
  if (isDeliveryImmediate(deliveryTime)) return true
  return false
}

/**
 * Clasifica una cotización en columna Kanban según cuántos items
 * tienen stock suficiente.
 */
function classifyByStock(
  items: Array<{ isReady: boolean }>
): KanbanColumn {
  if (items.length === 0) return 'pending'
  const readyCount = items.filter((i) => i.isReady).length
  if (readyCount === items.length) return 'ready'
  if (readyCount === 0) return 'pending'
  return 'partial'
}

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
          select: { id: true, name: true, cuit: true, taxCondition: true, paymentTerms: true, exchangeRateType: true },
        },
        salesPerson: {
          select: { id: true, name: true },
        },
        items: {
          where: { isAlternative: false },
          include: {
            product: { select: { sku: true, name: true, stockQuantity: true, trackInventory: true } },
            additionals: {
              include: {
                product: { select: { sku: true, name: true, stockQuantity: true } },
              },
            },
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
    interface AdditionalStockInfo {
      sku: string | null
      name: string | null
      stockQuantity: number | null
      hasStock: boolean // true si stock >= remainingQuantity del item padre
      shortage: number | null // cuánto falta (null si no falta)
    }

    interface ProcessedItem {
      id: string
      itemNumber: number
      description: string
      productSku: string | null
      quantity: number
      invoicedQuantity: number
      remainingQuantity: number
      unitPrice: number
      totalPrice: number
      deliveryTime: string | null
      isInStock: boolean
      isAlternative: boolean
      sentToColppy: boolean
      stockQuantity: number | null
      stockShortage: number | null // cantidad faltante del principal (null = sin problema)
      additionals: AdditionalStockInfo[] // info de stock de adicionales
    }

    interface BoardCardType {
      id: string
      quoteNumber: string
      customer: typeof quotes[0]['customer']
      salesPerson: typeof quotes[0]['salesPerson']
      currency: string
      total: number
      exchangeRate: number
      terms: string | null
      notes: string | null
      date: string
      readyItemsCount: number
      totalItemsCount: number
      farthestDelivery: string
      items: ProcessedItem[]
      column: KanbanColumn
      colppySyncedAt: string | null
      colppyInvoiceId: string | null
    }

    const boardCards: BoardCardType[] = []

    for (const quote of quotes) {
      // Calcular cantidad facturada por ítem
      const processedItems: ProcessedItem[] = quote.items.map((item) => {
        const invoicedQuantity = item.invoiceItems
          .filter((ii) => ii.invoice.status !== 'CANCELLED')
          .reduce((sum, ii) => sum + Number(ii.quantity), 0)

        const remainingQuantity = item.quantity - invoicedQuantity

        // Determinar si este ítem fue enviado a Colppy (tiene invoiceItems DRAFT)
        const sentToColppy = item.invoiceItems.some(
          (ii) => ii.invoice.status === 'DRAFT' && ii.invoice.notes?.includes('Colppy')
        )

        const stockQty = item.product?.stockQuantity ?? null
        const hasProduct = item.product != null
        const safeRemaining = Math.max(remainingQuantity, 0)
        const mainReady = isItemReady(stockQty, safeRemaining, item.deliveryTime, hasProduct)

        // Calcular shortage del principal
        let stockShortage: number | null = null
        if (!mainReady && hasProduct && stockQty != null && safeRemaining > 0) {
          stockShortage = safeRemaining - Math.max(stockQty, 0)
        }

        // Verificar stock de adicionales
        const additionalsInfo: AdditionalStockInfo[] = (item.additionals || []).map((add) => {
          const addStock = add.product?.stockQuantity ?? null
          const addHasProduct = add.product != null
          const addHasStock = addHasProduct ? (addStock != null && addStock >= safeRemaining) : true
          const addShortage = (add.product != null && addStock != null && !addHasStock && safeRemaining > 0)
            ? safeRemaining - Math.max(addStock, 0)
            : null
          return {
            sku: add.product?.sku || null,
            name: add.product?.name || add.description || null,
            stockQuantity: addStock,
            hasStock: addHasStock,
            shortage: addShortage,
          }
        })

        // Item listo solo si principal + todos los adicionales tienen stock
        const allAdditionalsReady = additionalsInfo.every((a) => a.hasStock)
        const ready = mainReady && allAdditionalsReady

        return {
          id: item.id,
          itemNumber: item.itemNumber,
          description: item.product?.name || item.description || 'Sin descripción',
          productSku: item.product?.sku || item.manualSku || null,
          quantity: item.quantity,
          invoicedQuantity,
          remainingQuantity,
          unitPrice: Number(item.unitPrice),
          totalPrice: Number(item.totalPrice),
          deliveryTime: item.deliveryTime,
          isInStock: ready,
          isAlternative: item.isAlternative,
          sentToColppy,
          stockQuantity: stockQty,
          stockShortage,
          additionals: additionalsInfo,
        }
      })

      // Solo items pendientes de facturar para clasificación
      const pendingItems = processedItems.filter((i) => i.remainingQuantity > 0)

      // Clasificar por stock real
      const column = classifyByStock(
        pendingItems.map((i) => ({ isReady: i.isInStock }))
      )

      const readyItemsCount = pendingItems.filter((i) => i.isInStock).length
      const totalItemsCount = pendingItems.length

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
    const columns: Record<KanbanColumn, BoardCardType[]> = {
      ready: [],
      partial: [],
      pending: [],
    }

    for (const card of boardCards) {
      columns[card.column].push(card)
    }

    // Calcular totales por columna
    const computeColumnStats = (cards: BoardCardType[]) => ({
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
    logger.error('Error fetching facturacion board:', error)
    return NextResponse.json(
      { error: 'Error al cargar tablero de facturación' },
      { status: 500 }
    )
  }
}

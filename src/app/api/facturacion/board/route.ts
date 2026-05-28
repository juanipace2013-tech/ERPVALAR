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
 * 1. Producto vinculado con stockQuantity conocido → exigir stock >= remaining.
 * 2. Producto vinculado SIN stockQuantity (null) → considerar SIN stock disponible
 *    (errar conservador). Antes caíamos al deliveryTime acá, lo que producía
 *    falsos verdes en el Kanban cuando un producto no rastreaba inventario
 *    (ej. servicios o productos legacy sin track). Verificado con VAL-2026-521.
 * 3. Item manual sin producto → usar deliveryTime como señal.
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
  // Producto vinculado SIN stock trackeado → conservador, no marcar como listo.
  if (hasProduct && stockQuantity == null) {
    return false
  }
  // Item manual sin producto → confiar en deliveryTime
  if (isDeliveryImmediate(deliveryTime)) return true
  return false
}

// Throttle del log [CONSISTENCY]: no loguear más de 1 vez por cotización por
// minuto. Mapa en module scope; se reinicia al reiniciar PM2 (aceptable).
const consistencyLogThrottle = new Map<string, number>()

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

    // Buscar cotizaciones facturables: ACCEPTED (sin facturar) y FACTURADA_PARCIAL
    // (ya tienen al menos una factura parcial enviada a Colppy y quedan items pendientes).
    const quotes = await prisma.quote.findMany({
      where: {
        status: { in: ['ACCEPTED', 'FACTURADA_PARCIAL'] },
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
      billingTargetDate: string | null
      billingNote: string | null
      billingNoteUpdatedAt: string | null
      billingNoteUpdatedByName: string | null
    }

    // Resolver nombres de los últimos editores de billingNote en una sola query
    const editorIds = Array.from(
      new Set(quotes.map((q) => q.billingNoteUpdatedBy).filter((v): v is string => !!v))
    )
    const editorMap = new Map<string, string>()
    if (editorIds.length > 0) {
      const editors = await prisma.user.findMany({
        where: { id: { in: editorIds } },
        select: { id: true, name: true },
      })
      for (const e of editors) editorMap.set(e.id, e.name)
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

      // Log temporal de monitoreo: items con producto vinculado pero stockQuantity=null
      // ahora se tratan como sin stock. Para medir el impacto del cambio durante 1-2 días.
      // Después se puede sacar o convertir en métrica formal.
      for (let i = 0; i < processedItems.length; i++) {
        const pi = processedItems[i]
        const orig = quote.items[i]
        if (
          orig.product != null &&
          orig.product.stockQuantity == null &&
          pi.remainingQuantity > 0
        ) {
          logger.info(
            `[BOARD_STOCK_NULL] quote=${quote.quoteNumber} item=${pi.productSku ?? 'n/a'} remaining=${pi.remainingQuantity} → tratado como sin stock`
          )
        }
      }

      // Clasificar por stock real
      const column = classifyByStock(
        pendingItems.map((i) => ({ isReady: i.isInStock }))
      )

      // Inconsistencia: FACTURADA_PARCIAL sin items pendientes debería ser CONVERTED.
      // Throttle 1 por cotización por minuto para no spamear si rebota.
      if (quote.status === 'FACTURADA_PARCIAL' && pendingItems.length === 0) {
        const last = consistencyLogThrottle.get(quote.id)
        const now = Date.now()
        if (!last || now - last > 60_000) {
          logger.warn(
            `[CONSISTENCY] Quote en FACTURADA_PARCIAL pero todos los items completamente facturados, debería ser CONVERTED — quote=${quote.quoteNumber}`
          )
          consistencyLogThrottle.set(quote.id, now)
        }
      }

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
        // Programación de facturación
        billingTargetDate: quote.billingTargetDate ? quote.billingTargetDate.toISOString() : null,
        billingNote: quote.billingNote ?? null,
        billingNoteUpdatedAt: quote.billingNoteUpdatedAt ? quote.billingNoteUpdatedAt.toISOString() : null,
        billingNoteUpdatedByName: quote.billingNoteUpdatedBy ? (editorMap.get(quote.billingNoteUpdatedBy) ?? null) : null,
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
            some: { status: { in: ['ACCEPTED', 'FACTURADA_PARCIAL'] } },
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

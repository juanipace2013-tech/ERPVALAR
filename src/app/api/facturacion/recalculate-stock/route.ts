import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isItemInStock, classifyQuote, type KanbanColumn } from '@/lib/facturacion-utils'

interface StatusChange {
  quoteNumber: string
  customerName: string
  from: string
  to: string
}

const COLUMN_LABELS: Record<KanbanColumn, string> = {
  ready: 'Listas para Facturar',
  partial: 'Facturación Parcial',
  pending: 'Pendientes',
}

/**
 * POST /api/facturacion/recalculate-stock
 *
 * Recalcula el estado de las cotizaciones aceptadas en el tablero de facturación
 * comparando el stock real de cada producto vs la cantidad del item.
 *
 * Si un item tiene stock suficiente y su deliveryTime no es "Inmediato",
 * se actualiza a "Inmediato" para que pase a la columna correcta.
 *
 * Si un item ya NO tiene stock suficiente y su deliveryTime es "Inmediato",
 * se actualiza a "Sin stock" para reflejar la realidad.
 */
export async function POST() {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // 1. Obtener todas las cotizaciones ACCEPTED con items y stock de productos
    const quotes = await prisma.quote.findMany({
      where: {
        status: 'ACCEPTED',
      },
      include: {
        customer: {
          select: { name: true },
        },
        items: {
          where: { isAlternative: false },
          include: {
            product: {
              select: { id: true, stockQuantity: true, name: true },
            },
            invoiceItems: {
              include: {
                invoice: { select: { status: true } },
              },
            },
          },
        },
      },
    })

    const changes: StatusChange[] = []
    let itemsUpdated = 0

    for (const quote of quotes) {
      // Calcular la columna ACTUAL (antes de cambios)
      const columnBefore = classifyQuote(
        quote.items.map((i) => ({
          deliveryTime: i.deliveryTime,
          isAlternative: i.isAlternative,
        }))
      )

      // Para cada item, verificar stock real
      const itemUpdates: Array<{ id: string; newDeliveryTime: string }> = []

      for (const item of quote.items) {
        if (!item.product) continue // Item manual sin producto, no se puede verificar stock

        // Calcular cantidad ya facturada
        const invoicedQuantity = item.invoiceItems
          .filter((ii) => ii.invoice.status !== 'CANCELLED')
          .reduce((sum, ii) => sum + Number(ii.quantity), 0)

        const remainingQuantity = item.quantity - invoicedQuantity
        if (remainingQuantity <= 0) continue // Item ya completamente facturado

        const currentStock = item.product.stockQuantity
        const hasStock = currentStock >= remainingQuantity
        const currentlyMarkedInStock = isItemInStock(item.deliveryTime)

        if (hasStock && !currentlyMarkedInStock) {
          // Stock disponible pero el item no está marcado como "Inmediato"
          // → Actualizarlo a "Inmediato"
          itemUpdates.push({ id: item.id, newDeliveryTime: 'Inmediato' })
        } else if (!hasStock && currentlyMarkedInStock && item.deliveryTime !== null) {
          // No hay stock pero estaba marcado como en stock (y tenía un deliveryTime original)
          // Solo marcar como sin stock si NO era originalmente null/Inmediato desde la cotización
          // Para no perder el estado original, lo marcamos como "Sin stock"
          itemUpdates.push({ id: item.id, newDeliveryTime: 'Sin stock' })
        }
      }

      // Aplicar actualizaciones a los items
      if (itemUpdates.length > 0) {
        for (const update of itemUpdates) {
          await prisma.quoteItem.update({
            where: { id: update.id },
            data: { deliveryTime: update.newDeliveryTime },
          })
        }
        itemsUpdated += itemUpdates.length

        // Recalcular la columna DESPUÉS de los cambios
        // Reconstruir los deliveryTimes actualizados
        const updatedDeliveryTimes = quote.items.map((i) => {
          const update = itemUpdates.find((u) => u.id === i.id)
          return {
            deliveryTime: update ? update.newDeliveryTime : i.deliveryTime,
            isAlternative: i.isAlternative,
          }
        })

        const columnAfter = classifyQuote(updatedDeliveryTimes)

        if (columnBefore !== columnAfter) {
          changes.push({
            quoteNumber: quote.quoteNumber,
            customerName: quote.customer.name,
            from: COLUMN_LABELS[columnBefore],
            to: COLUMN_LABELS[columnAfter],
          })
        }
      }
    }

    return NextResponse.json({
      success: true,
      quotesChecked: quotes.length,
      itemsUpdated,
      changes,
      summary:
        changes.length > 0
          ? `${changes.length} cotización(es) cambiaron de estado`
          : 'No hubo cambios de estado',
    })
  } catch (error) {
    console.error('Error recalculating stock status:', error)
    return NextResponse.json(
      { error: 'Error al recalcular estados de facturación' },
      { status: 500 }
    )
  }
}

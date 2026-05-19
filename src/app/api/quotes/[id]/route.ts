import { logger } from '@/lib/logger'
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { invalidateCustomerCache } from '@/lib/colppy/customer-cache'
import { parseCivilDate } from '@/lib/date-helpers'

/**
 * GET /api/quotes/[id]
 * Obtener cotización con todos sus items
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params

    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            businessName: true,
            cuit: true,
            taxCondition: true,
            address: true,
            city: true,
            province: true,
            email: true,
            phone: true,
            priceMultiplier: true,
            paymentTerms: true,
            defaultTransportName: true,
            defaultTransportAddress: true,
            defaultTransportSchedule: true,
          },
        },
        salesPerson: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                brand: true,
                listPriceUSD: true,
                unit: true,
              },
            },
            additionals: {
              include: {
                product: {
                  select: {
                    id: true,
                    sku: true,
                    name: true,
                    listPriceUSD: true,
                  },
                },
              },
              orderBy: {
                position: 'asc',
              },
            },
            alternatives: {
              include: {
                product: true,
                additionals: {
                  include: {
                    product: true,
                  },
                },
              },
            },
            invoiceItems: {
              select: {
                quantity: true,
                invoice: { select: { status: true } },
              },
            },
          },
          orderBy: [{ itemNumber: 'asc' }, { isAlternative: 'asc' }],
        },
        deliveryNotes: {
          select: {
            id: true,
            deliveryNumber: true,
            date: true,
            deliveryDate: true,
            status: true,
          },
          orderBy: {
            date: 'desc',
          },
        },
        invoices: {
          select: {
            id: true,
            invoiceNumber: true,
            invoiceType: true,
            issueDate: true,
            total: true,
            status: true,
            afipStatus: true,
            paymentStatus: true,
          },
          orderBy: {
            issueDate: 'desc',
          },
        },
        statusHistory: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        facturas: {
          orderBy: { fecha: 'asc' },
          include: {
            items: true,
            deliveryNotes: {
              select: {
                id: true,
                deliveryNumber: true,
                date: true,
                status: true,
              },
            },
          },
        },
      },
    })

    if (!quote) {
      return NextResponse.json(
        { error: 'Cotización no encontrada' },
        { status: 404 }
      )
    }

    return NextResponse.json(quote)
  } catch (error) {
    logger.error('Error fetching quote:', error)
    return NextResponse.json(
      { error: 'Error al obtener cotización' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/quotes/[id]
 * Actualizar cotización
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()

    // Estado previo — necesario para detectar transición de pricesIncludeTax
    const existingQuote = await prisma.quote.findUnique({
      where: { id },
      select: { pricesIncludeTax: true },
    })
    const oldPricesIncludeTax = existingQuote?.pricesIncludeTax ?? false

    // Verificar si el multiplicador cambió para recalcular items
    const multiplierChanged = body.multiplier !== undefined
    // Verificar si el flag de IVA-incluido cambió (valor distinto al actual)
    const pricesIncludeTaxChanged =
      body.pricesIncludeTax !== undefined && body.pricesIncludeTax !== oldPricesIncludeTax

    const updateData: Record<string, unknown> = {}
    if (body.status !== undefined) updateData.status = body.status
    if (body.terms !== undefined) updateData.terms = body.terms
    if (body.notes !== undefined) updateData.notes = body.notes
    if (body.validUntil !== undefined) updateData.validUntil = body.validUntil ? parseCivilDate(body.validUntil) : null
    if (body.exchangeRate !== undefined) updateData.exchangeRate = body.exchangeRate
    if (body.multiplier !== undefined) updateData.multiplier = body.multiplier
    if (body.bonification !== undefined) updateData.bonification = body.bonification
    if (body.tenderNumber !== undefined) updateData.tenderNumber = body.tenderNumber || null
    if (body.pricesIncludeTax !== undefined) updateData.pricesIncludeTax = body.pricesIncludeTax

    const quote = await prisma.quote.update({
      where: { id },
      data: updateData,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            businessName: true,
            priceMultiplier: true,
          },
        },
        salesPerson: true,
        items: {
          include: {
            product: {
              include: { category: true },
            },
            additionals: {
              include: {
                product: true,
              },
            },
          },
        },
      },
    })

    // Si el multiplicador cambió, recalcular todos los items
    if (multiplierChanged && quote.items.length > 0) {
      const newMultiplier = Number(quote.multiplier)
      // Si la cotización está en modo IVA-incluido, preservamos ese estado al
      // recalcular: el precio neto se escala por 1.21 para que siga incluyendo IVA.
      const ivaFactor = quote.pricesIncludeTax ? 1.21 : 1

      for (const item of quote.items) {
        // Items con multiplierOverride mantienen su multiplicador personalizado
        const hasOverride = item.multiplierOverride !== null
        const effectiveMultiplier = hasOverride ? Number(item.multiplierOverride) : newMultiplier

        const listPrice = Number(item.listPrice)
        let additionalsPrices = 0
        for (const add of item.additionals) {
          additionalsPrices += Number(add.listPrice)
        }

        const subtotalWithAdditionals = listPrice + additionalsPrices
        const brandDiscount = Number(item.brandDiscount)
        const afterDiscount = subtotalWithAdditionals * (1 - brandDiscount)
        const unitPrice = afterDiscount * effectiveMultiplier * ivaFactor
        const totalPrice = unitPrice * item.quantity

        await prisma.quoteItem.update({
          where: { id: item.id },
          data: {
            customerMultiplier: effectiveMultiplier,
            unitPrice,
            totalPrice,
          },
        })
      }

      // Recalcular totales de la cotización
      const mainItems = await prisma.quoteItem.findMany({
        where: { quoteId: id, isAlternative: false },
      })
      const subtotal = mainItems.reduce((sum, item) => sum + Number(item.totalPrice), 0)
      const bonif = Number(quote.bonification) || 0
      const total = subtotal * (1 - bonif / 100)
      await prisma.quote.update({
        where: { id },
        data: { subtotal, total },
      })
    }

    // Guardar el multiplicador en el Customer para futuras cotizaciones.
    // Se ejecuta independientemente del recalculo de items: el flag vive en el
    // Customer y no depende de que la quote actual tenga o no items cargados.
    if (multiplierChanged && body.saveMultiplierToCustomer) {
      const newMultiplier = Number(quote.multiplier)
      const updatedCustomer = await prisma.customer.update({
        where: { id: quote.customerId },
        data: { priceMultiplier: newMultiplier },
        select: { cuit: true },
      })
      logger.info(
        `[quotes/${id}] priceMultiplier persistido en Customer ${quote.customerId}: ${newMultiplier}`
      )
      invalidateCustomerCache(updatedCustomer.cuit || undefined)
    }

    // Si cambió el flag pricesIncludeTax (y no hubo recalculo por multiplicador),
    // escalar todos los items por 1.21 (activar IVA-incluido) o 1/1.21 (desactivar).
    // Esto permite toggle reversible sin perder precisión si no se vuelven a tocar.
    if (pricesIncludeTaxChanged && !multiplierChanged && quote.items.length > 0) {
      const factor = quote.pricesIncludeTax ? 1.21 : 1 / 1.21
      for (const item of quote.items) {
        await prisma.quoteItem.update({
          where: { id: item.id },
          data: {
            unitPrice: Number(item.unitPrice) * factor,
            totalPrice: Number(item.totalPrice) * factor,
          },
        })
      }
      const mainItems = await prisma.quoteItem.findMany({
        where: { quoteId: id, isAlternative: false },
      })
      const subtotal = mainItems.reduce((sum, item) => sum + Number(item.totalPrice), 0)
      const bonif = Number(quote.bonification) || 0
      const total = subtotal * (1 - bonif / 100)
      await prisma.quote.update({
        where: { id },
        data: { subtotal, total },
      })
    }

    // Si la bonificación cambió (sin cambio de multiplicador), recalcular total
    if (body.bonification !== undefined && !multiplierChanged) {
      const mainItems = await prisma.quoteItem.findMany({
        where: { quoteId: id, isAlternative: false },
      })
      const subtotal = mainItems.reduce((sum, item) => sum + Number(item.totalPrice), 0)
      const bonif = Number(body.bonification) || 0
      const total = subtotal * (1 - bonif / 100)
      await prisma.quote.update({
        where: { id },
        data: { subtotal, total },
      })
    }

    // Recargar quote actualizado
    const updatedQuote = await prisma.quote.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            businessName: true,
            priceMultiplier: true,
          },
        },
        salesPerson: true,
        items: {
          include: {
            product: true,
            additionals: {
              include: {
                product: true,
              },
            },
          },
          orderBy: [{ itemNumber: 'asc' }, { isAlternative: 'asc' }],
        },
      },
    })

    return NextResponse.json(updatedQuote)
  } catch (error) {
    logger.error('Error updating quote:', error)
    return NextResponse.json(
      { error: 'Error al actualizar cotización' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/quotes/[id]
 * Eliminar cotización
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params

    await prisma.quote.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting quote:', error)
    return NextResponse.json(
      { error: 'Error al eliminar cotización' },
      { status: 500 }
    )
  }
}

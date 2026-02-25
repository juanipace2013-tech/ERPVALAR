import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

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
    console.error('Error fetching quote:', error)
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

    // Verificar si el multiplicador cambió para recalcular items
    const multiplierChanged = body.multiplier !== undefined

    const updateData: Record<string, unknown> = {}
    if (body.status !== undefined) updateData.status = body.status
    if (body.terms !== undefined) updateData.terms = body.terms
    if (body.notes !== undefined) updateData.notes = body.notes
    if (body.validUntil !== undefined) updateData.validUntil = body.validUntil ? new Date(body.validUntil) : null
    if (body.exchangeRate !== undefined) updateData.exchangeRate = body.exchangeRate
    if (body.multiplier !== undefined) updateData.multiplier = body.multiplier

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

      for (const item of quote.items) {
        const listPrice = Number(item.listPrice)
        let additionalsPrices = 0
        for (const add of item.additionals) {
          additionalsPrices += Number(add.listPrice)
        }

        const subtotalWithAdditionals = listPrice + additionalsPrices
        const brandDiscount = Number(item.brandDiscount)
        const afterDiscount = subtotalWithAdditionals * (1 - brandDiscount)
        const unitPrice = afterDiscount * newMultiplier
        const totalPrice = unitPrice * item.quantity

        await prisma.quoteItem.update({
          where: { id: item.id },
          data: {
            customerMultiplier: newMultiplier,
            unitPrice,
            totalPrice,
          },
        })
      }

      // Recalcular totales de la cotización
      const mainItems = await prisma.quoteItem.findMany({
        where: { quoteId: id, isAlternative: false },
      })
      const total = mainItems.reduce((sum, item) => sum + Number(item.totalPrice), 0)
      await prisma.quote.update({
        where: { id },
        data: { subtotal: total, total },
      })

      // Opcionalmente guardar en el Customer para próximas cotizaciones
      if (body.saveMultiplierToCustomer) {
        await prisma.customer.update({
          where: { id: quote.customerId },
          data: { priceMultiplier: newMultiplier },
        })
      }
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
    console.error('Error updating quote:', error)
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
    console.error('Error deleting quote:', error)
    return NextResponse.json(
      { error: 'Error al eliminar cotización' },
      { status: 500 }
    )
  }
}

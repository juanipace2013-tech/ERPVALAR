import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
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
    const session = await getServerSession(authOptions)
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
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()

    const quote = await prisma.quote.update({
      where: { id },
      data: {
        status: body.status,
        terms: body.terms,
        notes: body.notes,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        exchangeRate: body.exchangeRate,
      },
      include: {
        customer: true,
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
        },
      },
    })

    return NextResponse.json(quote)
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
    const session = await getServerSession(authOptions)
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

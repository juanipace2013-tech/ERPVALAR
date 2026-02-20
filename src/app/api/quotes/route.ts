import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

/**
 * GET /api/quotes
 * Lista todas las cotizaciones con filtros
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const search = searchParams.get('search')

    const where: Record<string, unknown> = {}

    if (status && status !== 'ALL') {
      where.status = status
    }

    if (search) {
      where.OR = [
        { quoteNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ]
    }

    const quotes = await prisma.quote.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        salesPerson: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        date: 'desc',
      },
    })

    return NextResponse.json({ quotes })
  } catch (error) {
    console.error('Error fetching quotes:', error)
    return NextResponse.json(
      { error: 'Error al obtener cotizaciones' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/quotes
 * Crea una nueva cotización
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json()

    console.log('📥 Creando cotización:', body)

    // Generar número de cotización
    const year = new Date().getFullYear()
    const lastQuote = await prisma.quote.findFirst({
      where: {
        quoteNumber: {
          startsWith: `VAL-${year}-`,
        },
      },
      orderBy: {
        quoteNumber: 'desc',
      },
    })

    let nextNumber = 1
    if (lastQuote) {
      const match = lastQuote.quoteNumber.match(/VAL-\d{4}-(\d{3})/)
      if (match) {
        nextNumber = parseInt(match[1]) + 1
      }
    }

    const quoteNumber = `VAL-${year}-${String(nextNumber).padStart(3, '0')}`

    // Crear cotización
    const quote = await prisma.quote.create({
      data: {
        quoteNumber,
        customerId: body.customerId,
        salesPersonId: session.user.id,
        opportunityId: body.opportunityId,
        date: new Date(body.date || Date.now()),
        exchangeRate: body.exchangeRate,
        currency: body.currency || 'USD',
        subtotal: body.subtotal || 0,
        total: body.total || 0,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        terms: body.terms,
        notes: body.notes,
        status: 'DRAFT',
      },
      include: {
        customer: true,
        salesPerson: true,
      },
    })

    // Registrar actividad
    await prisma.activity.create({
      data: {
        type: 'QUOTE_CREATED',
        userId: session.user.id,
        entityType: 'quote',
        entityId: quote.id,
        customerId: quote.customerId,
        title: `Cotización creada: ${quote.quoteNumber}`,
        description: `Se creó la cotización ${quote.quoteNumber} para ${quote.customer.name}`,
      },
    })

    console.log('✅ Cotización creada:', quote.quoteNumber)

    return NextResponse.json(quote, { status: 201 })
  } catch (error) {
    console.error('❌ Error al crear cotización:', error)
    return NextResponse.json(
      {
        error: 'Error al crear cotización',
        message: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 }
    )
  }
}

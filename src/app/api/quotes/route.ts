import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { getMultiplierForClient } from '@/lib/client-multipliers'

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
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const salesPersonId = searchParams.get('salesPersonId')

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

    if (dateFrom || dateTo) {
      const dateFilter: Record<string, Date> = {}
      if (dateFrom) dateFilter.gte = new Date(dateFrom)
      if (dateTo) {
        const endDate = new Date(dateTo)
        endDate.setHours(23, 59, 59, 999)
        dateFilter.lte = endDate
      }
      where.date = dateFilter
    }

    if (salesPersonId) {
      where.salesPersonId = salesPersonId
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

    // Si se envió un cliente de Colppy, hacer upsert en la base de datos local
    let customerId = body.customerId

    if (body.colppyCustomer) {
      const colppyCustomer = body.colppyCustomer

      // Buscar o crear el cliente por CUIT
      const existingCustomer = await prisma.customer.findFirst({
        where: { cuit: colppyCustomer.cuit },
      })

      if (existingCustomer) {
        // Actualizar datos del cliente existente
        const updatedCustomer = await prisma.customer.update({
          where: { id: existingCustomer.id },
          data: {
            name: colppyCustomer.name,
            businessName: colppyCustomer.businessName,
            taxCondition: colppyCustomer.taxCondition,
            email: colppyCustomer.email || existingCustomer.email,
            phone: colppyCustomer.phone || existingCustomer.phone,
            mobile: colppyCustomer.mobile || existingCustomer.mobile,
            address: colppyCustomer.address || existingCustomer.address,
            city: colppyCustomer.city || existingCustomer.city,
            province: colppyCustomer.province || existingCustomer.province,
            postalCode: colppyCustomer.postalCode || existingCustomer.postalCode,
            // NO sobreescribir priceMultiplier: se gestiona manualmente por el usuario
            balance: colppyCustomer.saldo || existingCustomer.balance,
          },
        })
        customerId = updatedCustomer.id
        console.log('✅ Cliente actualizado desde Colppy:', updatedCustomer.name)
      } else {
        // Crear nuevo cliente - buscar multiplicador preconfigurado por razón social
        const razonSocial = colppyCustomer.businessName || colppyCustomer.name
        const configuredMultiplier = getMultiplierForClient(razonSocial)

        const newCustomer = await prisma.customer.create({
          data: {
            name: colppyCustomer.name,
            businessName: colppyCustomer.businessName,
            cuit: colppyCustomer.cuit,
            taxCondition: colppyCustomer.taxCondition,
            email: colppyCustomer.email || null,
            phone: colppyCustomer.phone || null,
            mobile: colppyCustomer.mobile || null,
            address: colppyCustomer.address || null,
            city: colppyCustomer.city || null,
            province: colppyCustomer.province || null,
            postalCode: colppyCustomer.postalCode || null,
            priceMultiplier: configuredMultiplier,
            balance: colppyCustomer.saldo || 0,
            status: 'ACTIVE',
            type: 'BUSINESS',
          },
        })
        customerId = newCustomer.id
        console.log(`✅ Cliente creado desde Colppy: ${newCustomer.name} (multiplicador: ${configuredMultiplier}x)`)
      }
    }

    // Validar que tenemos un customerId
    if (!customerId) {
      return NextResponse.json(
        { error: 'Debe proporcionar customerId o colppyCustomer' },
        { status: 400 }
      )
    }

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

    // Obtener multiplicador del cliente para precargar en la cotización
    const customerForMultiplier = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { priceMultiplier: true },
    })
    const customerMultiplier = customerForMultiplier ? Number(customerForMultiplier.priceMultiplier) : 1.0

    // Crear cotización
    const quote = await prisma.quote.create({
      data: {
        quoteNumber,
        customerId,
        salesPersonId: session.user.id,
        opportunityId: body.opportunityId,
        date: new Date(body.date || Date.now()),
        exchangeRate: body.exchangeRate,
        currency: body.currency || 'USD',
        multiplier: body.multiplier || customerMultiplier,
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

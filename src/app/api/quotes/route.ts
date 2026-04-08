import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { getMultiplierForClient } from '@/lib/client-multipliers'
import { logAudit } from '@/lib/audit'
import { normalizeCuit, buildCuitWhereClause } from '@/lib/cuit-utils'
import { logger } from '@/lib/logger'

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
    const customerCuit = searchParams.get('customerCuit')
    const excludeStatus = searchParams.get('excludeStatus')

    const seguimientoFilter = searchParams.get('seguimiento')

    const where: Record<string, unknown> = {}

    if (status && status !== 'ALL') {
      where.status = status
    } else if (excludeStatus) {
      where.status = { not: excludeStatus }
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

    // Filtros de seguimiento
    if (seguimientoFilter) {
      const hace7dias = new Date()
      hace7dias.setDate(hace7dias.getDate() - 7)

      if (seguimientoFilter === 'sin') {
        where.seguimientos = { none: {} }
      } else if (seguimientoFilter === 'reciente') {
        where.seguimientos = { some: { fecha: { gte: hace7dias } } }
      } else if (seguimientoFilter === 'requiere_atencion') {
        // Vencidas hace +7 días Y sin seguimiento reciente
        where.validUntil = { lt: hace7dias }
        where.status = { in: ['SENT', 'EXPIRED'] }
        where.AND = [
          {
            OR: [
              { seguimientos: { none: {} } },
              { seguimientos: { every: { fecha: { lt: hace7dias } } } },
            ],
          },
        ]
      }
    }

    if (customerCuit) {
      where.customer = { cuit: customerCuit }
    }

    // Paginación
    const page = parseInt(searchParams.get('page') || '0')
    const pageSize = parseInt(searchParams.get('pageSize') || '50')

    const [quotes, totalCount] = await Promise.all([
      prisma.quote.findMany({
        where,
        select: {
          id: true,
          quoteNumber: true,
          date: true,
          status: true,
          total: true,
          currency: true,
          exchangeRate: true,
          validUntil: true,
          tenderNumber: true,
          colppySyncedAt: true,
          purchaseOrderUrl: true,
          rejectionReason: true,
          statusUpdatedAt: true,
          bonification: true,
          subtotal: true,
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
          seguimientos: {
            select: { id: true, fecha: true },
            orderBy: { fecha: 'desc' as const },
            take: 1,
          },
          _count: {
            select: { seguimientos: true },
          },
          ...(customerCuit ? {
            items: {
              where: { isAlternative: false },
              select: {
                id: true,
                itemNumber: true,
                quantity: true,
                unitPrice: true,
                totalPrice: true,
                product: {
                  select: { id: true, sku: true, name: true, unit: true },
                },
              },
              orderBy: { itemNumber: 'asc' as const },
            },
          } : {}),
        },
        orderBy: {
          date: 'desc',
        },
        take: pageSize,
        skip: page * pageSize,
      }),
      prisma.quote.count({ where }),
    ])

    return NextResponse.json({ quotes, totalCount, page, pageSize })
  } catch (error) {
    logger.error('Error fetching quotes:', error)
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

    logger.info('📥 Creando cotización:', body)

    // Si se envió un cliente de Colppy, hacer upsert en la base de datos local
    let customerId = body.customerId

    if (body.colppyCustomer) {
      const colppyCustomer = body.colppyCustomer

      // Buscar o crear el cliente por CUIT (ambos formatos)
      const normalizedCuit = normalizeCuit(colppyCustomer.cuit)
      const existingCustomer = normalizedCuit
        ? await prisma.customer.findFirst({ where: buildCuitWhereClause(normalizedCuit) })
        : null

      if (existingCustomer) {
        // Actualizar datos del cliente existente
        // Si el multiplicador en DB es 1.0 (default) y la tabla tiene uno configurado, sincronizar
        const razonSocial = colppyCustomer.businessName || colppyCustomer.name
        const configuredMultiplier = getMultiplierForClient(razonSocial)
        const currentMultiplier = Number(existingCustomer.priceMultiplier)
        const shouldSyncMultiplier = currentMultiplier === 1.0 && configuredMultiplier !== 1.0

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
            // Sincronizar multiplicador solo si está en default (1.0) y hay uno configurado
            ...(shouldSyncMultiplier && { priceMultiplier: configuredMultiplier }),
            balance: colppyCustomer.saldo || existingCustomer.balance,
          },
        })
        customerId = updatedCustomer.id
        if (shouldSyncMultiplier) {
          logger.info(`✅ Cliente actualizado desde Colppy: ${updatedCustomer.name} (multiplicador sincronizado: ${configuredMultiplier}x)`)
        } else {
          logger.info('✅ Cliente actualizado desde Colppy:', updatedCustomer.name)
        }
      } else {
        // Crear nuevo cliente - buscar multiplicador preconfigurado por razón social
        const razonSocial = colppyCustomer.businessName || colppyCustomer.name
        const configuredMultiplier = getMultiplierForClient(razonSocial)

        const newCustomer = await prisma.customer.create({
          data: {
            name: colppyCustomer.name,
            businessName: colppyCustomer.businessName,
            cuit: normalizedCuit || colppyCustomer.cuit,
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
        logger.info(`✅ Cliente creado desde Colppy: ${newCustomer.name} (multiplicador: ${configuredMultiplier}x)`)
      }
    }

    // Validar que tenemos un customerId
    if (!customerId) {
      return NextResponse.json(
        { error: 'Debe proporcionar customerId o colppyCustomer' },
        { status: 400 }
      )
    }

    // Obtener multiplicador del cliente para precargar en la cotización
    const customerForMultiplier = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { priceMultiplier: true },
    })
    const customerMultiplier = customerForMultiplier ? Number(customerForMultiplier.priceMultiplier) : 1.0

    // Generar número + crear cotización en transacción para evitar race conditions
    const quote = await prisma.$transaction(async (tx) => {
      const year = new Date().getFullYear()
      const lastQuote = await tx.quote.findFirst({
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

      return tx.quote.create({
        data: {
          quoteNumber,
          customerId,
          salesPersonId: body.salesPersonId || session.user.id,
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
          tenderNumber: body.tenderNumber || null,
          status: 'DRAFT',
        },
        include: {
          customer: true,
          salesPerson: true,
        },
      })
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

    // Registrar auditoría
    logAudit({
      userId: session.user.id,
      userName: session.user.name || '',
      userEmail: session.user.email || '',
      action: 'CREATE',
      entity: 'QUOTE',
      entityId: quote.id,
      entityRef: quote.quoteNumber,
      description: `Creó cotización ${quote.quoteNumber} para ${quote.customer.name}`,
    })

    logger.info('✅ Cotización creada:', quote.quoteNumber)

    return NextResponse.json(quote, { status: 201 })
  } catch (error) {
    logger.error('❌ Error al crear cotización:', error)
    return NextResponse.json(
      {
        error: 'Error al crear cotización',
        message: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 }
    )
  }
}

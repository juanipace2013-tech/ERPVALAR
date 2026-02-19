import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'


import { prisma } from '@/lib/prisma'
import { customerSchema } from '@/lib/validations'
import { z } from 'zod'

// GET /api/clientes - Listar clientes con filtros y paginación
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || ''
    const province = searchParams.get('province') || ''
    const sortBy = searchParams.get('sortBy') || 'balance'
    const sortOrder = searchParams.get('sortOrder') || 'desc'

    const skip = (page - 1) * limit

    // Construir filtros
    const where: any = {}

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { businessName: { contains: search, mode: 'insensitive' } },
        { cuit: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (status) {
      where.status = status
    }

    if (province) {
      where.province = province
    }

    // Construir ordenamiento dinámico
    // Validar campos permitidos para ordenamiento
    const allowedSortFields = ['name', 'businessName', 'balance', 'createdAt', 'cuit']
    const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'balance'
    const validSortOrder = sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : 'desc'

    // Obtener clientes con paginación
    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [validSortBy]: validSortOrder },
        include: {
          salesPerson: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          contacts: {
            where: { isPrimary: true },
            take: 1,
          },
          _count: {
            select: {
              opportunities: true,
              quotes: true,
              invoices: true,
            },
          },
        },
      }),
      prisma.customer.count({ where }),
    ])

    return NextResponse.json({
      customers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching customers:', error)
    return NextResponse.json(
      { error: 'Error al obtener clientes' },
      { status: 500 }
    )
  }
}

// POST /api/clientes - Crear nuevo cliente
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json()

    // Validar datos
    const validatedData = customerSchema.parse(body)

    // Verificar si el CUIT ya existe
    const existingCustomer = await prisma.customer.findUnique({
      where: { cuit: validatedData.cuit },
    })

    if (existingCustomer) {
      return NextResponse.json(
        { error: 'Ya existe un cliente con este CUIT' },
        { status: 400 }
      )
    }

    // Crear cliente
    const customer = await prisma.customer.create({
      data: {
        name: validatedData.name,
        businessName: validatedData.businessName,
        type: validatedData.type,
        cuit: validatedData.cuit,
        taxCondition: validatedData.taxCondition,
        email: validatedData.email || null,
        phone: validatedData.phone,
        mobile: validatedData.mobile,
        website: validatedData.website || null,
        address: validatedData.address,
        city: validatedData.city,
        province: validatedData.province,
        postalCode: validatedData.postalCode,
        country: validatedData.country,
        status: validatedData.status,
        creditLimit: validatedData.creditLimit,
        creditCurrency: validatedData.creditCurrency,
        paymentTerms: validatedData.paymentTerms,
        discount: validatedData.discount,
        notes: validatedData.notes,
      },
    })

    // Registrar actividad
    await prisma.activity.create({
      data: {
        type: 'CUSTOMER_CREATED',
        userId: session.user.id,
        entityType: 'customer',
        entityId: customer.id,
        customerId: customer.id,
        title: `Cliente creado: ${customer.name}`,
        description: `Se creó el cliente ${customer.name} (${customer.cuit})`,
      },
    })

    return NextResponse.json(customer, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: (error as any).errors },
        { status: 400 }
      )
    }

    console.error('Error creating customer:', error)
    return NextResponse.json(
      { error: 'Error al crear cliente' },
      { status: 500 }
    )
  }
}

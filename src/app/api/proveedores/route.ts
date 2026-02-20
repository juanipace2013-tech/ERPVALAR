import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

// GET /api/proveedores - Listar proveedores con filtros y paginación
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
    const sortBy = searchParams.get('sortBy') || 'name'
    const sortOrder = searchParams.get('sortOrder') || 'asc'

    const skip = (page - 1) * limit

    // Construir filtros
    const where: Record<string, unknown> = {}

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { legalName: { contains: search, mode: 'insensitive' } },
        { taxId: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (status) {
      where.status = status
    }

    // Construir ordenamiento dinámico
    const allowedSortFields = ['name', 'legalName', 'balance', 'discount', 'createdAt']
    const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'name'
    const validSortOrder = sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : 'asc'

    // Obtener proveedores con paginación
    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [validSortBy]: validSortOrder },
        include: {
          buyerUser: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
      prisma.supplier.count({ where }),
    ])

    return NextResponse.json({
      suppliers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching suppliers:', error)
    return NextResponse.json(
      { error: 'Error al obtener proveedores' },
      { status: 500 }
    )
  }
}

// POST /api/proveedores - Crear nuevo proveedor
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json()

    // Validar CUIT si existe
    if (body.taxId) {
      const existingSupplier = await prisma.supplier.findUnique({
        where: { taxId: body.taxId },
      })

      if (existingSupplier) {
        return NextResponse.json(
          { error: 'Ya existe un proveedor con este CUIT' },
          { status: 400 }
        )
      }
    }

    // Crear proveedor
    const supplier = await prisma.supplier.create({
      data: {
        name: body.name,
        legalName: body.legalName || null,
        taxId: body.taxId || null,
        email: body.email || null,
        phone: body.phone || null,
        mobile: body.mobile || null,
        address: body.address || null,
        city: body.city || null,
        province: body.province || null,
        postalCode: body.postalCode || null,
        website: body.website || null,
        discount: body.discount || 0,
        paymentDays: body.paymentDays || 30,
        balance: 0,
        category: body.category || null,
        brands: body.brands || [],
        status: body.status || 'ACTIVE',
        isPreferred: body.isPreferred || false,
        paymentTerms: body.paymentTerms || null,
        accountNumber: body.accountNumber || null,
        notes: body.notes || null,
        internalNotes: body.internalNotes || null,
        buyerUserId: body.buyerUserId || null,
      },
    })

    return NextResponse.json(supplier, { status: 201 })
  } catch (error) {
    console.error('Error creating supplier:', error)
    return NextResponse.json(
      { error: 'Error al crear proveedor' },
      { status: 500 }
    )
  }
}

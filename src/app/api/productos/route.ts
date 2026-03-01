import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { productWithPricesSchema } from '@/lib/validations'
import { z } from 'zod'

// GET /api/productos - Listar productos con filtros y paginación
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || ''
    const categoryId = searchParams.get('categoryId') || ''
    const supplierId = searchParams.get('supplierId') || ''
    const type = searchParams.get('type') || '' // Nuevo filtro por tipo
    const letter = searchParams.get('letter') || '' // Filtro alfabético
    const orderBy = searchParams.get('orderBy') || 'sku' // Campo de ordenamiento
    const order = searchParams.get('order') || 'asc' // Dirección (asc/desc)

    const skip = (page - 1) * limit

    // Construir filtros
    const where: Record<string, unknown> = {}

    if (search) {
      where.OR = [
        { sku: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Filtro alfabético por primera letra del SKU
    if (letter && letter !== 'ALL') {
      where.sku = {
        startsWith: letter,
        mode: 'insensitive'
      }
    }

    if (status) {
      where.status = status
    }

    if (categoryId) {
      where.categoryId = categoryId
    }

    if (supplierId) {
      where.supplierId = supplierId
    }

    if (type && type !== 'ALL') {
      where.type = type
    }

    // Construir orderBy dinámico
    const validOrderFields = ['sku', 'name', 'brand', 'listPriceUSD', 'createdAt']
    const orderField = validOrderFields.includes(orderBy) ? orderBy : 'sku'
    const orderDirection = order === 'desc' ? 'desc' : 'asc'

    // Obtener productos con paginación
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          [orderField]: orderDirection,
        },
        include: {
          category: {
            select: {
              id: true,
              name: true,
            },
          },
          prices: {
            where: {
              OR: [
                { validUntil: null },
                { validUntil: { gte: new Date() } },
              ],
            },
            orderBy: {
              validFrom: 'desc',
            },
          },
        },
      }),
      prisma.product.count({ where }),
    ])

    return NextResponse.json({
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching products:', error)
    return NextResponse.json(
      { error: 'Error al obtener productos' },
      { status: 500 }
    )
  }
}

// POST /api/productos - Crear nuevo producto
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json()

    console.log('📥 Datos recibidos en API:', JSON.stringify(body, null, 2))

    // Validar datos
    const validatedData = productWithPricesSchema.parse(body)

    console.log('✅ Datos validados:', JSON.stringify(validatedData, null, 2))

    // Verificar si el SKU ya existe
    const existingProduct = await prisma.product.findUnique({
      where: { sku: validatedData.sku },
    })

    if (existingProduct) {
      return NextResponse.json(
        { error: 'Ya existe un producto con este SKU' },
        { status: 400 }
      )
    }

    // Crear producto con precios
    const product = await prisma.product.create({
      data: {
        sku: validatedData.sku,
        name: validatedData.name,
        description: validatedData.description,
        type: validatedData.type,
        categoryId: validatedData.categoryId,
        supplierId: validatedData.supplierId,
        brand: validatedData.brand,
        stockQuantity: validatedData.stockQuantity,
        minStock: validatedData.minStock,
        maxStock: validatedData.maxStock,
        unit: validatedData.unit,
        lastCost: validatedData.lastCost,
        averageCost: validatedData.averageCost,
        listPriceUSD: validatedData.listPriceUSD,
        status: validatedData.status,
        isTaxable: validatedData.isTaxable,
        taxRate: validatedData.taxRate,
        trackInventory: validatedData.trackInventory,
        allowNegative: validatedData.allowNegative,
        images: validatedData.images,
        notes: validatedData.notes,
        prices: validatedData.prices
          ? {
              create: validatedData.prices.map((price) => ({
                currency: price.currency,
                priceType: price.priceType,
                amount: price.amount,
                validFrom: price.validFrom || new Date(),
                validUntil: price.validUntil,
              })),
            }
          : undefined,
      },
      include: {
        prices: true,
        category: true,
      },
    })

    // Registrar actividad
    await prisma.activity.create({
      data: {
        type: 'PRODUCT_CREATED',
        userId: session.user.id,
        entityType: 'product',
        entityId: product.id,
        title: `Producto creado: ${product.name}`,
        description: `Se creó el producto ${product.name} (SKU: ${product.sku})`,
      },
    })

    return NextResponse.json(product, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ ERROR DE VALIDACIÓN ZOD:')
      console.error(JSON.stringify(error.issues, null, 2))

      // Crear mensajes de error más legibles
      const errorMessages = error.issues.map(err => {
        const field = err.path.join('.')
        const message = err.message
        return `Campo "${field}": ${message}`
      })

      return NextResponse.json(
        {
          error: 'Errores de validación',
          message: errorMessages.join(' | '),
          details: error.issues.map(err => ({
            path: err.path,
            message: err.message,
            code: err.code,
            received: 'received' in err ? (err as unknown as { received: string }).received : undefined,
          }))
        },
        { status: 400 }
      )
    }

    console.error('❌ ERROR AL CREAR PRODUCTO:', error)
    if (error instanceof Error) {
      console.error('Mensaje:', error.message)
      console.error('Stack:', error.stack)
    }

    return NextResponse.json(
      {
        error: 'Error al crear producto',
        message: error instanceof Error ? error.message : 'Error desconocido'
      },
      { status: 500 }
    )
  }
}

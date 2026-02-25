import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

// GET /api/ordenes-compra - Listar órdenes de compra con filtros
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const supplierId = searchParams.get('supplierId') || ''
    const status = searchParams.get('status') || ''
    const search = searchParams.get('search') || ''

    const skip = (page - 1) * limit

    // Construir filtros
    const where: Record<string, unknown> = {}

    if (supplierId) {
      where.supplierId = supplierId
    }

    if (status) {
      where.status = status
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Obtener órdenes con paginación
    const [orders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          orderDate: 'desc',
        },
        include: {
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              items: true,
              payments: true,
            },
          },
        },
      }),
      prisma.purchaseOrder.count({ where }),
    ])

    return NextResponse.json({
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching purchase orders:', error)
    return NextResponse.json(
      { error: 'Error al obtener órdenes de compra' },
      { status: 500 }
    )
  }
}

// POST /api/ordenes-compra - Crear nueva orden de compra
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json()

    // Generar número de orden
    const count = await prisma.purchaseOrder.count()
    const orderNumber = `OC-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`

    // Calcular totales
    let subtotal = 0
    let taxAmount = 0

    for (const item of body.items) {
      const itemSubtotal = item.quantity * item.unitCost * (1 - (item.discount || 0) / 100)
      subtotal += itemSubtotal
      taxAmount += itemSubtotal * ((item.taxRate || 0) / 100)
    }

    const discount = body.discount || 0
    const total = subtotal + taxAmount - discount

    // Crear orden de compra con items
    const order = await prisma.purchaseOrder.create({
      data: {
        orderNumber,
        supplierId: body.supplierId,
        userId: session.user.id,
        status: body.status || 'DRAFT',
        currency: body.currency || 'ARS',
        subtotal,
        taxAmount,
        discount,
        total,
        orderDate: body.orderDate ? new Date(body.orderDate) : new Date(),
        expectedDate: body.expectedDate ? new Date(body.expectedDate) : null,
        notes: body.notes || null,
        items: {
          create: body.items.map((item: { productId: string; quantity: number; unitCost: number; discount?: number; taxRate?: number; description?: string; notes?: string }) => ({
            productId: item.productId,
            quantity: item.quantity,
            receivedQty: 0,
            unitCost: item.unitCost,
            discount: item.discount || 0,
            taxRate: item.taxRate || 21,
            subtotal: item.quantity * item.unitCost * (1 - (item.discount || 0) / 100),
            description: item.description || null,
          })),
        },
      },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
              },
            },
          },
        },
      },
    })

    // Actualizar saldo del proveedor si la orden está aprobada
    if (body.status === 'APPROVED' || body.status === 'RECEIVED') {
      await prisma.supplier.update({
        where: { id: body.supplierId },
        data: {
          balance: {
            increment: total,
          },
        },
      })
    }

    return NextResponse.json(order, { status: 201 })
  } catch (error) {
    console.error('Error creating purchase order:', error)
    return NextResponse.json(
      { error: 'Error al crear orden de compra' },
      { status: 500 }
    )
  }
}

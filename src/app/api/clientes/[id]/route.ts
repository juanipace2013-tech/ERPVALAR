import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { customerSchema } from '@/lib/validations'
import { z } from 'zod'

// GET /api/clientes/[id] - Obtener cliente por ID
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
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        salesPerson: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        contacts: {
          orderBy: {
            isPrimary: 'desc',
          },
        },
        opportunities: {
          take: 5,
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            user: {
              select: {
                name: true,
              },
            },
          },
        },
        quotes: {
          take: 5,
          orderBy: {
            createdAt: 'desc',
          },
        },
        invoices: {
          take: 5,
          orderBy: {
            createdAt: 'desc',
          },
        },
        activities: {
          take: 10,
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            user: {
              select: {
                name: true,
              },
            },
          },
        },
        _count: {
          select: {
            opportunities: true,
            quotes: true,
            invoices: true,
          },
        },
      },
    })

    if (!customer) {
      return NextResponse.json(
        { error: 'Cliente no encontrado' },
        { status: 404 }
      )
    }

    return NextResponse.json(customer)
  } catch (error) {
    console.error('Error fetching customer:', error)
    return NextResponse.json(
      { error: 'Error al obtener cliente' },
      { status: 500 }
    )
  }
}

// PUT /api/clientes/[id] - Actualizar cliente
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

    // Validar datos
    const validatedData = customerSchema.parse(body)

    // Verificar si el cliente existe
    const existingCustomer = await prisma.customer.findUnique({
      where: { id },
    })

    if (!existingCustomer) {
      return NextResponse.json(
        { error: 'Cliente no encontrado' },
        { status: 404 }
      )
    }

    // Verificar si el CUIT ya existe en otro cliente
    if (validatedData.cuit !== existingCustomer.cuit) {
      const cuitExists = await prisma.customer.findFirst({
        where: {
          cuit: validatedData.cuit,
          id: { not: id },
        },
      })

      if (cuitExists) {
        return NextResponse.json(
          { error: 'Ya existe otro cliente con este CUIT' },
          { status: 400 }
        )
      }
    }

    // Actualizar cliente
    const customer = await prisma.customer.update({
      where: { id },
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
        priceMultiplier: validatedData.priceMultiplier,
        salesPersonId: validatedData.salesPersonId,
        notes: validatedData.notes,
      },
      include: {
        salesPerson: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        _count: {
          select: {
            opportunities: true,
            quotes: true,
            invoices: true,
          },
        },
      },
    })

    // Registrar actividad
    await prisma.activity.create({
      data: {
        type: 'CUSTOMER_UPDATED',
        userId: session.user.id,
        entityType: 'customer',
        entityId: customer.id,
        customerId: customer.id,
        title: `Cliente actualizado: ${customer.name}`,
        description: `Se actualizó el cliente ${customer.name}`,
      },
    })

    return NextResponse.json(customer)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: error.issues },
        { status: 400 }
      )
    }

    console.error('Error updating customer:', error)
    return NextResponse.json(
      { error: 'Error al actualizar cliente' },
      { status: 500 }
    )
  }
}

// DELETE /api/clientes/[id] - Eliminar cliente
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

    // Solo ADMIN puede eliminar clientes
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'No tienes permisos para eliminar clientes' },
        { status: 403 }
      )
    }

    // Verificar si el cliente existe
    const customer = await prisma.customer.findUnique({
      where: { id },
    })

    if (!customer) {
      return NextResponse.json(
        { error: 'Cliente no encontrado' },
        { status: 404 }
      )
    }

    // Verificar si tiene datos relacionados
    const [opportunitiesCount, quotesCount, invoicesCount] = await Promise.all([
      prisma.opportunity.count({ where: { customerId: id } }),
      prisma.quote.count({ where: { customerId: id } }),
      prisma.invoice.count({ where: { customerId: id } }),
    ])

    if (opportunitiesCount > 0 || quotesCount > 0 || invoicesCount > 0) {
      return NextResponse.json(
        {
          error:
            'No se puede eliminar el cliente porque tiene oportunidades, cotizaciones o facturas asociadas',
        },
        { status: 400 }
      )
    }

    // Eliminar cliente (cascade eliminará contactos y actividades)
    await prisma.customer.delete({
      where: { id },
    })

    // Registrar actividad
    await prisma.activity.create({
      data: {
        type: 'CUSTOMER_DELETED',
        userId: session.user.id,
        entityType: 'customer',
        entityId: customer.id,
        title: `Cliente eliminado: ${customer.name}`,
        description: `Se eliminó el cliente ${customer.name} (${customer.cuit})`,
      },
    })

    return NextResponse.json({ message: 'Cliente eliminado exitosamente' })
  } catch (error) {
    console.error('Error deleting customer:', error)
    return NextResponse.json(
      { error: 'Error al eliminar cliente' },
      { status: 500 }
    )
  }
}

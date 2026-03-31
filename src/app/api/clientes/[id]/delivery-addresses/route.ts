import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

// GET /api/clientes/[id]/delivery-addresses
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

    const addresses = await prisma.customerDeliveryAddress.findMany({
      where: { customerId: id, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
    })

    return NextResponse.json({ addresses })
  } catch (error) {
    logger.error('Error fetching delivery addresses:', error)
    return NextResponse.json(
      { error: 'Error al obtener direcciones de entrega' },
      { status: 500 }
    )
  }
}

// POST /api/clientes/[id]/delivery-addresses
export async function POST(
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

    if (!body.label?.trim() || !body.address?.trim()) {
      return NextResponse.json(
        { error: 'Label y dirección son requeridos' },
        { status: 400 }
      )
    }

    // Verificar que el cliente existe
    const customer = await prisma.customer.findUnique({ where: { id } })
    if (!customer) {
      return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
    }

    const address = await prisma.$transaction(async (tx) => {
      // Si es default, desmarcar las otras
      if (body.isDefault) {
        await tx.customerDeliveryAddress.updateMany({
          where: { customerId: id, isDefault: true },
          data: { isDefault: false },
        })
      }

      return tx.customerDeliveryAddress.create({
        data: {
          customerId: id,
          label: body.label.trim(),
          address: body.address.trim(),
          city: body.city?.trim() || null,
          province: body.province?.trim() || null,
          postalCode: body.postalCode?.trim() || null,
          country: body.country?.trim() || 'Argentina',
          contactName: body.contactName?.trim() || null,
          contactPhone: body.contactPhone?.trim() || null,
          contactEmail: body.contactEmail?.trim() || null,
          schedule: body.schedule?.trim() || null,
          notes: body.notes?.trim() || null,
          isDefault: body.isDefault || false,
        },
      })
    })

    return NextResponse.json({ address }, { status: 201 })
  } catch (error) {
    logger.error('Error creating delivery address:', error)
    return NextResponse.json(
      { error: 'Error al crear dirección de entrega' },
      { status: 500 }
    )
  }
}

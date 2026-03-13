import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// PUT /api/clientes/[id]/delivery-addresses/[addressId]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; addressId: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id, addressId } = await params
    const body = await request.json()

    // Verificar que la dirección pertenece al cliente
    const existing = await prisma.customerDeliveryAddress.findFirst({
      where: { id: addressId, customerId: id, isActive: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Dirección no encontrada' }, { status: 404 })
    }

    const address = await prisma.$transaction(async (tx) => {
      // Si se marca como default, desmarcar las otras
      if (body.isDefault) {
        await tx.customerDeliveryAddress.updateMany({
          where: { customerId: id, isDefault: true, id: { not: addressId } },
          data: { isDefault: false },
        })
      }

      return tx.customerDeliveryAddress.update({
        where: { id: addressId },
        data: {
          ...(body.label !== undefined && { label: body.label.trim() }),
          ...(body.address !== undefined && { address: body.address.trim() }),
          ...(body.city !== undefined && { city: body.city?.trim() || null }),
          ...(body.province !== undefined && { province: body.province?.trim() || null }),
          ...(body.postalCode !== undefined && { postalCode: body.postalCode?.trim() || null }),
          ...(body.country !== undefined && { country: body.country?.trim() || 'Argentina' }),
          ...(body.contactName !== undefined && { contactName: body.contactName?.trim() || null }),
          ...(body.contactPhone !== undefined && { contactPhone: body.contactPhone?.trim() || null }),
          ...(body.contactEmail !== undefined && { contactEmail: body.contactEmail?.trim() || null }),
          ...(body.schedule !== undefined && { schedule: body.schedule?.trim() || null }),
          ...(body.notes !== undefined && { notes: body.notes?.trim() || null }),
          ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
        },
      })
    })

    return NextResponse.json({ address })
  } catch (error) {
    console.error('Error updating delivery address:', error)
    return NextResponse.json(
      { error: 'Error al actualizar dirección de entrega' },
      { status: 500 }
    )
  }
}

// DELETE /api/clientes/[id]/delivery-addresses/[addressId] — soft delete
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; addressId: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id, addressId } = await params

    const existing = await prisma.customerDeliveryAddress.findFirst({
      where: { id: addressId, customerId: id, isActive: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Dirección no encontrada' }, { status: 404 })
    }

    await prisma.customerDeliveryAddress.update({
      where: { id: addressId },
      data: { isActive: false },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting delivery address:', error)
    return NextResponse.json(
      { error: 'Error al eliminar dirección de entrega' },
      { status: 500 }
    )
  }
}

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * PATCH /api/clientes/assign-salesperson
 * Asigna un vendedor a un cliente por CUIT.
 * Si el cliente no existe localmente, crea un registro mínimo.
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const { cuit, salesPersonId } = body

    if (!cuit || typeof cuit !== 'string') {
      return NextResponse.json(
        { error: 'CUIT es requerido' },
        { status: 400 }
      )
    }

    const normalizedCuit = cuit.replace(/\D/g, '')
    if (normalizedCuit.length !== 11) {
      return NextResponse.json(
        { error: 'CUIT debe tener 11 dígitos' },
        { status: 400 }
      )
    }

    // Validar que el vendedor existe si se asigna uno
    if (salesPersonId) {
      const user = await prisma.user.findUnique({
        where: { id: salesPersonId },
        select: { id: true, status: true },
      })
      if (!user) {
        return NextResponse.json(
          { error: 'Vendedor no encontrado' },
          { status: 404 }
        )
      }
    }

    // Buscar cliente por CUIT (ambos formatos)
    const formattedCuit = `${normalizedCuit.slice(0, 2)}-${normalizedCuit.slice(2, 10)}-${normalizedCuit.slice(10)}`

    let customer = await prisma.customer.findFirst({
      where: {
        OR: [
          { cuit: normalizedCuit },
          { cuit: formattedCuit },
          { cuit: { contains: normalizedCuit } },
        ],
      },
      select: { id: true },
    })

    if (customer) {
      // Actualizar vendedor
      await prisma.customer.update({
        where: { id: customer.id },
        data: { salesPersonId: salesPersonId || null },
      })
    } else {
      // Crear registro mínimo para clientes que solo existen en Colppy
      customer = await prisma.customer.create({
        data: {
          name: formattedCuit, // Se actualizará cuando se sincronice con Colppy
          cuit: normalizedCuit,
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          salesPersonId: salesPersonId || null,
        },
        select: { id: true },
      })
    }

    // Obtener el vendedor actualizado para retornar
    const updated = await prisma.customer.findUnique({
      where: { id: customer.id },
      select: {
        salesPerson: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    return NextResponse.json({
      success: true,
      salesPerson: updated?.salesPerson || null,
    })
  } catch (error: any) {
    console.error('Error assigning salesperson:', error)
    return NextResponse.json(
      { error: error.message || 'Error al asignar vendedor' },
      { status: 500 }
    )
  }
}

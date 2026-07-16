import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { logAudit } from '@/lib/audit'
import { VENDEDOR_SELECCIONABLE } from '@/lib/vendedores'

/**
 * PATCH /api/clientes/assign-salesperson
 * Asigna un vendedor a un cliente por CUIT. salesPersonId null/vacío deja al
 * cliente sin vendedor fijo (modo automático: la cotización queda para quien
 * la crea).
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

    // Validar que el vendedor existe y es asignable (activo + vendedor).
    // Antes sólo se chequeaba la existencia, así que se podía asignar un
    // usuario dado de baja o alguien de administración.
    let nuevoVendedor: { id: string; name: string } | null = null
    if (salesPersonId) {
      nuevoVendedor = await prisma.user.findFirst({
        where: { id: salesPersonId, ...VENDEDOR_SELECCIONABLE },
        select: { id: true, name: true },
      })
      if (!nuevoVendedor) {
        return NextResponse.json(
          { error: 'El vendedor seleccionado no existe, no está activo o no es vendedor' },
          { status: 400 }
        )
      }
    }

    // Buscar cliente por CUIT (ambos formatos)
    const formattedCuit = `${normalizedCuit.slice(0, 2)}-${normalizedCuit.slice(2, 10)}-${normalizedCuit.slice(10)}`

    const existente = await prisma.customer.findFirst({
      where: {
        OR: [
          { cuit: normalizedCuit },
          { cuit: formattedCuit },
          { cuit: { contains: normalizedCuit } },
        ],
      },
      select: {
        id: true,
        name: true,
        cuit: true,
        salesPerson: { select: { id: true, name: true } },
      },
    })

    const nuevoNombre = nuevoVendedor?.name || 'sin vendedor fijo'
    let customerId: string

    if (existente) {
      customerId = existente.id

      await prisma.customer.update({
        where: { id: existente.id },
        data: { salesPersonId: salesPersonId || null },
      })

      logAudit({
        userId: session.user.id,
        userName: session.user.name || '',
        userEmail: session.user.email || '',
        action: 'REASIGNAR_VENDEDOR',
        entity: 'CLIENT',
        entityId: existente.id,
        entityRef: existente.cuit,
        description:
          `Reasignó vendedor de ${existente.name}: ` +
          `${existente.salesPerson?.name || 'sin vendedor fijo'} → ${nuevoNombre}`,
      })
    } else {
      // Crear registro mínimo para clientes que solo existen en Colppy
      const creado = await prisma.customer.create({
        data: {
          name: formattedCuit, // Se actualizará cuando se sincronice con Colppy
          cuit: formattedCuit,
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          salesPersonId: salesPersonId || null,
        },
        select: { id: true },
      })
      customerId = creado.id

      logAudit({
        userId: session.user.id,
        userName: session.user.name || '',
        userEmail: session.user.email || '',
        action: 'CREATE',
        entity: 'CLIENT',
        entityId: creado.id,
        entityRef: formattedCuit,
        description: `Creó cliente mínimo ${formattedCuit} con vendedor: ${nuevoNombre}`,
      })
    }

    // Obtener el vendedor actualizado para retornar
    const updated = await prisma.customer.findUnique({
      where: { id: customerId },
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
    logger.error('Error assigning salesperson:', error)
    return NextResponse.json(
      { error: error.message || 'Error al asignar vendedor' },
      { status: 500 }
    )
  }
}

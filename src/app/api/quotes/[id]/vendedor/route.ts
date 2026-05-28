import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const { nuevoVendedorId, motivo } = body as {
      nuevoVendedorId: string
      motivo?: string
    }

    if (!nuevoVendedorId) {
      return NextResponse.json(
        { error: 'Se requiere nuevoVendedorId' },
        { status: 400 }
      )
    }

    const cotizacion = await prisma.quote.findUnique({
      where: { id },
      include: { salesPerson: { select: { id: true, name: true, email: true } } },
    })
    if (!cotizacion) {
      return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })
    }

    const vendedorNuevo = await prisma.user.findUnique({
      where: { id: nuevoVendedorId },
      select: { id: true, name: true, email: true, status: true },
    })
    if (!vendedorNuevo || vendedorNuevo.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'El vendedor seleccionado no existe o no está activo' },
        { status: 400 }
      )
    }

    if (nuevoVendedorId === cotizacion.salesPersonId) {
      return NextResponse.json(
        { error: 'El vendedor seleccionado ya es el asignado actualmente' },
        { status: 400 }
      )
    }

    const estadosCerrados = ['ACCEPTED', 'REJECTED', 'CONVERTED', 'FACTURADA_PARCIAL']
    if (estadosCerrados.includes(cotizacion.status) && !motivo?.trim()) {
      return NextResponse.json(
        { error: 'Se requiere motivo para reasignar cotizaciones cerradas' },
        { status: 400 }
      )
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.quote.update({
        where: { id },
        data: { salesPersonId: nuevoVendedorId },
        include: {
          salesPerson: { select: { id: true, name: true, email: true } },
          customer: { select: { id: true, name: true, businessName: true } },
        },
      })

      await tx.cotizacionAuditLog.create({
        data: {
          cotizacionId: id,
          usuarioId: session.user.id,
          accion: 'REASIGNAR_VENDEDOR',
          valorAnterior: {
            id: cotizacion.salesPerson.id,
            nombre: cotizacion.salesPerson.name,
            email: cotizacion.salesPerson.email,
          },
          valorNuevo: {
            id: vendedorNuevo.id,
            nombre: vendedorNuevo.name,
            email: vendedorNuevo.email,
          },
          motivo: motivo?.trim() || null,
        },
      })

      return result
    }, { maxWait: 10000, timeout: 30000 })

    logAudit({
      userId: session.user.id,
      userName: session.user.name || '',
      userEmail: session.user.email || '',
      action: 'REASIGNAR_VENDEDOR',
      entity: 'QUOTE',
      entityId: id,
      entityRef: cotizacion.quoteNumber,
      description: `Reasignó vendedor de cotización ${cotizacion.quoteNumber}: ${cotizacion.salesPerson.name} → ${vendedorNuevo.name}`,
    })

    return NextResponse.json({ ok: true, cotizacion: updated })
  } catch (error) {
    logger.error('Error reasignando vendedor:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al reasignar vendedor' },
      { status: 500 }
    )
  }
}

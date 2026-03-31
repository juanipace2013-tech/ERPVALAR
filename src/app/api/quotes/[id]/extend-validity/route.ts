import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { validUntil } = body

    if (!validUntil) {
      return NextResponse.json({ error: 'Debe proporcionar una fecha' }, { status: 400 })
    }

    const newDate = new Date(validUntil)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    if (newDate < today) {
      return NextResponse.json(
        { error: 'La fecha debe ser mayor o igual a hoy' },
        { status: 400 }
      )
    }

    const quote = await prisma.quote.findUnique({
      where: { id },
      select: { id: true, status: true },
    })

    if (!quote) {
      return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })
    }

    const allowedStatuses = ['DRAFT', 'SENT']
    if (!allowedStatuses.includes(quote.status)) {
      return NextResponse.json(
        { error: `No se puede modificar la validez de una cotización en estado ${quote.status}` },
        { status: 400 }
      )
    }

    const updated = await prisma.quote.update({
      where: { id },
      data: { validUntil: newDate },
      select: { id: true, validUntil: true },
    })

    return NextResponse.json({
      success: true,
      validUntil: updated.validUntil,
    })
  } catch (error: unknown) {
    logger.error('Error extending validity:', error)
    const message = error instanceof Error ? error.message : 'Error al actualizar validez'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

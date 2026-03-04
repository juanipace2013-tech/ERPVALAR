import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const TERMINAL_STATUSES = ['DELIVERED', 'NOT_DELIVERED', 'PICKED_UP']
const VALID_STATUSES = ['PENDING', 'PREPARING', 'IN_ROUTE', ...TERMINAL_STATUSES]

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id, stopId } = await params
    const { status } = await request.json()

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Estado no válido' }, { status: 400 })
    }

    // Verify stop belongs to this route
    const stop = await prisma.deliveryStop.findFirst({
      where: { id: stopId, routeId: id },
      select: { id: true, deliveryNoteId: true },
    })

    if (!stop) {
      return NextResponse.json({ error: 'Parada no encontrada' }, { status: 404 })
    }

    const isTerminal = TERMINAL_STATUSES.includes(status)

    const updated = await prisma.$transaction(async (tx) => {
      // Update stop status
      const updatedStop = await tx.deliveryStop.update({
        where: { id: stopId },
        data: {
          status: status as any,
          completedAt: isTerminal ? new Date() : null,
        },
      })

      // If DELIVERED and has linked delivery note, update its status too
      if (status === 'DELIVERED' && stop.deliveryNoteId) {
        await tx.deliveryNote.update({
          where: { id: stop.deliveryNoteId },
          data: { status: 'DELIVERED', deliveryDate: new Date() },
        })
      }

      return updatedStop
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Error changing stop status:', error)
    return NextResponse.json(
      { error: 'Error al cambiar estado de la parada' },
      { status: 500 }
    )
  }
}

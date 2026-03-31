import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

/** Solo se pueden eliminar paradas en estos estados */
const DELETABLE_STATUSES = ['PENDING', 'NOT_DELIVERED']

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id, stopId } = await params

    // Verificar que la parada existe y pertenece a esta ruta
    const stop = await prisma.deliveryStop.findFirst({
      where: { id: stopId, routeId: id },
      select: { id: true, status: true, deliveryNoteId: true },
    })

    if (!stop) {
      return NextResponse.json({ error: 'Parada no encontrada' }, { status: 404 })
    }

    if (!DELETABLE_STATUSES.includes(stop.status)) {
      return NextResponse.json(
        { error: `No se puede eliminar una parada en estado "${stop.status}". Solo se permiten: ${DELETABLE_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }

    await prisma.$transaction(async (tx) => {
      // Si tiene remito vinculado, liberar el remito para que vuelva a estar disponible
      if (stop.deliveryNoteId) {
        await tx.deliveryNote.update({
          where: { id: stop.deliveryNoteId },
          data: { status: 'READY' },
        })
      }

      // Eliminar la parada
      await tx.deliveryStop.delete({
        where: { id: stopId },
      })
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error('Error deleting stop:', error)
    return NextResponse.json(
      { error: 'Error al eliminar la parada' },
      { status: 500 }
    )
  }
}

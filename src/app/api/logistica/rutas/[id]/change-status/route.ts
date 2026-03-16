import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const TERMINAL_STATUSES = ['DELIVERED', 'NOT_DELIVERED', 'PICKED_UP']
const VALID_STATUSES = ['PLANNING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params
    const { status } = await request.json()

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Estado no válido' }, { status: 400 })
    }

    const route = await prisma.deliveryRoute.findUnique({
      where: { id },
      include: {
        stops: { select: { id: true, status: true, deliveryNoteId: true } },
      },
    })

    if (!route) {
      return NextResponse.json({ error: 'Hoja de ruta no encontrada' }, { status: 404 })
    }

    // Validate transition to COMPLETED: all stops must be in terminal status
    if (status === 'COMPLETED') {
      const allResolved = route.stops.every((stop) =>
        TERMINAL_STATUSES.includes(stop.status)
      )
      if (!allResolved) {
        return NextResponse.json(
          { error: 'Todas las paradas deben estar resueltas para completar la ruta' },
          { status: 400 }
        )
      }
    }

    // Validate transition to CANCELLED: cannot cancel if already COMPLETED or CANCELLED
    if (status === 'CANCELLED') {
      if (route.status === 'COMPLETED' || route.status === 'CANCELLED') {
        return NextResponse.json(
          { error: 'No se puede anular una ruta ya completada o anulada' },
          { status: 400 }
        )
      }

      // Cancel route and revert non-delivered remitos in a transaction
      const updated = await prisma.$transaction(async (tx) => {
        // For each non-terminal stop: mark NOT_DELIVERED and revert linked remito
        for (const stop of route.stops) {
          if (TERMINAL_STATUSES.includes(stop.status)) continue

          await tx.deliveryStop.update({
            where: { id: stop.id },
            data: {
              status: 'NOT_DELIVERED',
              completedAt: new Date(),
              ...(stop.deliveryNoteId ? { deliveryNoteId: null } : {}),
            },
          })

          if (stop.deliveryNoteId) {
            await tx.deliveryNote.update({
              where: { id: stop.deliveryNoteId },
              data: { status: 'READY', deliveryDate: null },
            })
          }
        }

        // Change route status
        return tx.deliveryRoute.update({
          where: { id },
          data: { status: 'CANCELLED' },
          include: {
            stops: { orderBy: { order: 'asc' } },
            createdBy: { select: { id: true, name: true } },
          },
        })
      })

      return NextResponse.json(updated)
    }

    const updated = await prisma.deliveryRoute.update({
      where: { id },
      data: { status: status as any },
      include: {
        stops: {
          orderBy: { order: 'asc' },
        },
        createdBy: {
          select: { id: true, name: true },
        },
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Error changing route status:', error)
    return NextResponse.json(
      { error: 'Error al cambiar estado de la ruta' },
      { status: 500 }
    )
  }
}

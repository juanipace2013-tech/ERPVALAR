import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const TERMINAL_STATUSES = ['DELIVERED', 'NOT_DELIVERED', 'PICKED_UP']

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

    if (!['PLANNING', 'IN_PROGRESS', 'COMPLETED'].includes(status)) {
      return NextResponse.json({ error: 'Estado no válido' }, { status: 400 })
    }

    const route = await prisma.deliveryRoute.findUnique({
      where: { id },
      include: {
        stops: { select: { status: true } },
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

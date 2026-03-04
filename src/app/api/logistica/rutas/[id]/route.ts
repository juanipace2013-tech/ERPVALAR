import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params

    const route = await prisma.deliveryRoute.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: { id: true, name: true },
        },
        stops: {
          orderBy: { order: 'asc' },
          include: {
            deliveryNote: {
              select: {
                id: true,
                deliveryNumber: true,
                status: true,
                customer: {
                  select: { name: true },
                },
              },
            },
          },
        },
      },
    })

    if (!route) {
      return NextResponse.json({ error: 'Hoja de ruta no encontrada' }, { status: 404 })
    }

    return NextResponse.json(route)
  } catch (error) {
    console.error('Error fetching route:', error)
    return NextResponse.json(
      { error: 'Error al obtener hoja de ruta' },
      { status: 500 }
    )
  }
}

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
    const { date, notes, stops } = body

    // Verify route exists and is in PLANNING status
    const existing = await prisma.deliveryRoute.findUnique({
      where: { id },
      select: { id: true, status: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Hoja de ruta no encontrada' }, { status: 404 })
    }

    if (existing.status !== 'PLANNING') {
      return NextResponse.json(
        { error: 'Solo se pueden editar rutas en estado Planificación' },
        { status: 400 }
      )
    }

    const route = await prisma.$transaction(async (tx) => {
      // If stops provided, delete existing and recreate
      if (stops && stops.length > 0) {
        await tx.deliveryStop.deleteMany({ where: { routeId: id } })

        await tx.deliveryStop.createMany({
          data: stops.map((stop: any, index: number) => ({
            routeId: id,
            deliveryNoteId: stop.deliveryNoteId || null,
            order: stop.order ?? index + 1,
            type: stop.type || 'DELIVERY',
            customerName: stop.customerName,
            transportType: stop.transportType || 'OWN',
            transportName: stop.transportName || null,
            address: stop.address || null,
            city: stop.city || null,
            zone: stop.zone || 'CABA',
            schedule: stop.schedule || null,
            contactName: stop.contactName || null,
            contactPhone: stop.contactPhone || null,
            packages: stop.packages || 0,
            finalDestination: stop.finalDestination || null,
            trackingNumber: stop.trackingNumber || null,
            deliveryDeadline: stop.deliveryDeadline
              ? new Date(`${stop.deliveryDeadline}T12:00:00`)
              : null,
            observations: stop.observations || null,
          })),
        })
      }

      // Update route fields
      const updated = await tx.deliveryRoute.update({
        where: { id },
        data: {
          ...(date && { date: new Date(`${date}T12:00:00`) }),
          ...(notes !== undefined && { notes: notes || null }),
        },
        include: {
          stops: {
            orderBy: { order: 'asc' },
            include: {
              deliveryNote: {
                select: { id: true, deliveryNumber: true, status: true },
              },
            },
          },
          createdBy: {
            select: { id: true, name: true },
          },
        },
      })

      return updated
    })

    return NextResponse.json(route)
  } catch (error) {
    console.error('Error updating route:', error)
    return NextResponse.json(
      { error: 'Error al actualizar hoja de ruta' },
      { status: 500 }
    )
  }
}

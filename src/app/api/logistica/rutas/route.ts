import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    const where: any = {}

    if (status && status !== 'all') {
      where.status = status
    }

    if (dateFrom || dateTo) {
      where.date = {}
      if (dateFrom) where.date.gte = new Date(`${dateFrom}T00:00:00`)
      if (dateTo) where.date.lte = new Date(`${dateTo}T23:59:59`)
    }

    const routes = await prisma.deliveryRoute.findMany({
      where,
      include: {
        createdBy: {
          select: { id: true, name: true },
        },
        stops: {
          select: {
            id: true,
            status: true,
            zone: true,
            type: true,
          },
        },
        _count: {
          select: { stops: true },
        },
      },
      orderBy: { date: 'desc' },
    })

    return NextResponse.json(routes)
  } catch (error) {
    console.error('Error fetching routes:', error)
    return NextResponse.json(
      { error: 'Error al obtener hojas de ruta' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const { date, notes, stops } = body

    if (!date) {
      return NextResponse.json({ error: 'La fecha es requerida' }, { status: 400 })
    }

    if (!stops || stops.length === 0) {
      return NextResponse.json(
        { error: 'Debe agregar al menos una parada' },
        { status: 400 }
      )
    }

    const route = await prisma.$transaction(async (tx) => {
      // Create the route with nested stops
      const newRoute = await tx.deliveryRoute.create({
        data: {
          date: new Date(`${date}T12:00:00`),
          notes: notes || null,
          createdById: session.user!.id,
          stops: {
            create: stops.map((stop: any, index: number) => ({
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
          },
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

      return newRoute
    })

    return NextResponse.json(route, { status: 201 })
  } catch (error) {
    console.error('Error creating route:', error)
    return NextResponse.json(
      { error: 'Error al crear hoja de ruta' },
      { status: 500 }
    )
  }
}

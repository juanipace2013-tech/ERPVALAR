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
    const search = searchParams.get('search')

    const where: any = { type: 'PICKUP' }

    if (status === 'PENDING') {
      where.status = 'PENDING'
    } else if (status === 'COMPLETED') {
      where.status = 'PICKED_UP'
    }

    if (search) {
      where.customerName = { contains: search, mode: 'insensitive' }
    }

    const routeWhere: any = {}
    if (dateFrom) routeWhere.gte = new Date(`${dateFrom}T00:00:00`)
    if (dateTo) routeWhere.lte = new Date(`${dateTo}T23:59:59`)
    if (Object.keys(routeWhere).length > 0) {
      where.route = { date: routeWhere }
    }

    const retiros = await prisma.deliveryStop.findMany({
      where,
      include: {
        route: {
          select: {
            id: true,
            date: true,
            createdBy: { select: { id: true, name: true } },
          },
        },
        supplier: {
          select: {
            id: true,
            name: true,
            legalName: true,
            address: true,
            city: true,
            phone: true,
          },
        },
      },
      orderBy: [
        { route: { date: 'desc' } },
        { order: 'asc' },
      ],
      take: 200,
    })

    return NextResponse.json(retiros)
  } catch (error) {
    console.error('Error fetching retiros:', error)
    return NextResponse.json(
      { error: 'Error al obtener retiros' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const {
      supplierId,
      customerName,
      address,
      city,
      zone = 'CABA',
      materialDescription,
      observations,
      scheduledDate,
      contactName,
      contactPhone,
      routeId,
    } = body

    if (!customerName || !scheduledDate) {
      return NextResponse.json(
        { error: 'Nombre y fecha programada son obligatorios' },
        { status: 400 }
      )
    }

    // Resolve route
    let resolvedRouteId = routeId

    if (!resolvedRouteId) {
      // Look for an existing route on the scheduled date
      const dateStart = new Date(`${scheduledDate}T00:00:00`)
      const dateEnd = new Date(`${scheduledDate}T23:59:59`)

      const existingRoute = await prisma.deliveryRoute.findFirst({
        where: { date: { gte: dateStart, lte: dateEnd } },
        select: { id: true },
      })

      if (existingRoute) {
        resolvedRouteId = existingRoute.id
      } else {
        // Auto-create a route for this date
        const newRoute = await prisma.deliveryRoute.create({
          data: {
            date: new Date(`${scheduledDate}T12:00:00`),
            status: 'PLANNING',
            createdById: session.user.id,
          },
        })
        resolvedRouteId = newRoute.id
      }
    }

    // Get next order
    const maxOrder = await prisma.deliveryStop.aggregate({
      where: { routeId: resolvedRouteId },
      _max: { order: true },
    })
    const nextOrder = (maxOrder._max.order || 0) + 1

    const retiro = await prisma.deliveryStop.create({
      data: {
        routeId: resolvedRouteId,
        order: nextOrder,
        type: 'PICKUP',
        customerName,
        address: address || null,
        city: city || null,
        zone: zone as any,
        contactName: contactName || null,
        contactPhone: contactPhone || null,
        observations: observations || null,
        materialDescription: materialDescription || null,
        supplierId: supplierId || null,
        status: 'PENDING',
        transportType: 'OWN',
      },
      include: {
        route: {
          select: {
            id: true,
            date: true,
            createdBy: { select: { id: true, name: true } },
          },
        },
        supplier: {
          select: { id: true, name: true, address: true },
        },
      },
    })

    return NextResponse.json(retiro, { status: 201 })
  } catch (error) {
    console.error('Error creating retiro:', error)
    return NextResponse.json(
      { error: 'Error al crear retiro' },
      { status: 500 }
    )
  }
}

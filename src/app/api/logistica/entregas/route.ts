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
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const zone = searchParams.get('zone')
    const transportType = searchParams.get('transportType')
    const vendedorId = searchParams.get('vendedorId')

    // Build where clause
    const where: any = { type: 'DELIVERY' }

    if (zone && zone !== 'ALL') {
      where.zone = zone
    }

    if (transportType && transportType !== 'ALL') {
      where.transportType = transportType
    }

    // Route-level filters
    const routeWhere: any = {}
    if (dateFrom) routeWhere.gte = new Date(`${dateFrom}T00:00:00`)
    if (dateTo) routeWhere.lte = new Date(`${dateTo}T23:59:59`)
    if (vendedorId) {
      where.route = { ...(Object.keys(routeWhere).length > 0 ? { date: routeWhere } : {}), createdById: vendedorId }
    } else if (Object.keys(routeWhere).length > 0) {
      where.route = { date: routeWhere }
    }

    const stops = await prisma.deliveryStop.findMany({
      where,
      include: {
        route: {
          select: {
            id: true,
            date: true,
            status: true,
            createdBy: {
              select: { id: true, name: true },
            },
          },
        },
        deliveryNote: {
          select: {
            id: true,
            deliveryNumber: true,
          },
        },
      },
      orderBy: [
        { route: { date: 'desc' } },
        { order: 'asc' },
      ],
    })

    // Also fetch vendedores for filter dropdown
    const vendedores = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'GERENTE', 'VENDEDOR'] } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ stops, vendedores })
  } catch (error) {
    console.error('Error fetching entregas:', error)
    return NextResponse.json(
      { error: 'Error al obtener entregas' },
      { status: 500 }
    )
  }
}

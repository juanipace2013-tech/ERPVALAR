import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Remitos con estado READY o DISPATCHED que NO tengan parada asignada
    const remitos = await prisma.deliveryNote.findMany({
      where: {
        status: { in: ['READY', 'DISPATCHED'] },
        deliveryStops: { none: {} },
      },
      select: {
        id: true,
        deliveryNumber: true,
        date: true,
        deliveryAddress: true,
        deliveryCity: true,
        deliveryProvince: true,
        bultos: true,
        carrier: true,
        trackingNumber: true,
        customer: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            province: true,
            phone: true,
          },
        },
        items: {
          select: {
            description: true,
            quantity: true,
          },
        },
      },
      orderBy: { date: 'asc' },
    })

    return NextResponse.json(remitos)
  } catch (error) {
    console.error('Error fetching pending remitos:', error)
    return NextResponse.json(
      { error: 'Error al obtener remitos pendientes' },
      { status: 500 }
    )
  }
}

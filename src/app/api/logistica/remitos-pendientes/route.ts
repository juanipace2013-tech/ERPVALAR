import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

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
        transportAddress: true,
        trackingNumber: true,
        customer: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            province: true,
            phone: true,
            deliveryAddresses: {
              where: { isActive: true },
              select: {
                id: true,
                label: true,
                address: true,
                city: true,
                province: true,
                contactName: true,
                contactPhone: true,
                schedule: true,
              },
              orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
            },
          },
        },
        supplier: {
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
      orderBy: [
        { customer: { name: 'asc' } },
        { date: 'asc' },
      ],
    })

    return NextResponse.json(remitos)
  } catch (error) {
    logger.error('Error fetching pending remitos:', error)
    return NextResponse.json(
      { error: 'Error al obtener remitos pendientes' },
      { status: 500 }
    )
  }
}

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

// GET /api/clientes/[id]/transportes
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params

    const transports = await prisma.customerTransport.findMany({
      where: { customerId: id },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    })

    return NextResponse.json({ transports })
  } catch (error) {
    logger.error('Error fetching customer transports:', error)
    return NextResponse.json(
      { error: 'Error al obtener transportes' },
      { status: 500 }
    )
  }
}

// PUT /api/clientes/[id]/transportes
// Reemplaza la lista completa de transportes del cliente y sincroniza los
// campos legacy defaultTransport* con el transporte habitual (isDefault).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()

    if (!Array.isArray(body.transports)) {
      return NextResponse.json(
        { error: 'transports debe ser un array' },
        { status: 400 }
      )
    }

    const rows: Array<{ name: string; address: string | null; schedule: string | null; isDefault: boolean }> = []
    for (const t of body.transports) {
      const name = typeof t?.name === 'string' ? t.name.trim() : ''
      if (!name) continue // filas vacías del form se ignoran
      rows.push({
        name,
        address: typeof t.address === 'string' && t.address.trim() ? t.address.trim() : null,
        schedule: typeof t.schedule === 'string' && t.schedule.trim() ? t.schedule.trim() : null,
        isDefault: Boolean(t.isDefault),
      })
    }

    // Exactamente un habitual (si hay transportes): el primero marcado, o el primero de la lista.
    const defaultIndex = rows.findIndex((r) => r.isDefault)
    rows.forEach((r, i) => {
      r.isDefault = i === (defaultIndex === -1 ? 0 : defaultIndex)
    })
    const defaultRow = rows.find((r) => r.isDefault) || null

    const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true } })
    if (!customer) {
      return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
    }

    const transports = await prisma.$transaction(async (tx) => {
      await tx.customerTransport.deleteMany({ where: { customerId: id } })
      if (rows.length) {
        await tx.customerTransport.createMany({
          data: rows.map((r) => ({ ...r, customerId: id })),
        })
      }
      // Sincronizar campos legacy con el habitual
      await tx.customer.update({
        where: { id },
        data: {
          defaultTransportName: defaultRow?.name ?? null,
          defaultTransportAddress: defaultRow?.address ?? null,
          defaultTransportSchedule: defaultRow?.schedule ?? null,
        },
      })
      return tx.customerTransport.findMany({
        where: { customerId: id },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      })
    }, { maxWait: 10000, timeout: 30000 })

    return NextResponse.json({ transports })
  } catch (error) {
    logger.error('Error saving customer transports:', error)
    return NextResponse.json(
      { error: 'Error al guardar transportes' },
      { status: 500 }
    )
  }
}

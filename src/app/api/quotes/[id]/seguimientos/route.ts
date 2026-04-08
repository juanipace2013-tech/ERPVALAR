import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

/**
 * GET /api/quotes/[id]/seguimientos
 * Lista seguimientos de una cotización, ordenados por fecha DESC
 */
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

    const seguimientos = await prisma.quoteSeguimiento.findMany({
      where: { quoteId: id },
      orderBy: { fecha: 'desc' },
    })

    return NextResponse.json(seguimientos)
  } catch (error) {
    logger.error('Error fetching seguimientos:', error)
    return NextResponse.json(
      { error: 'Error al obtener seguimientos' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/quotes/[id]/seguimientos
 * Crear un seguimiento (body: { usuario, tipo, nota, fecha? })
 */
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
    const body = await request.json()

    const { usuario, tipo, nota, fecha } = body

    if (!usuario || !tipo || !nota) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos: usuario, tipo, nota' },
        { status: 400 }
      )
    }

    // Verificar que la cotización existe
    const quote = await prisma.quote.findUnique({
      where: { id },
      select: { id: true, quoteNumber: true },
    })

    if (!quote) {
      return NextResponse.json(
        { error: 'Cotización no encontrada' },
        { status: 404 }
      )
    }

    const seguimiento = await prisma.quoteSeguimiento.create({
      data: {
        quoteId: id,
        usuario,
        tipo,
        nota,
        fecha: fecha ? new Date(fecha) : new Date(),
      },
    })

    logger.info(`Seguimiento creado para ${quote.quoteNumber}: ${tipo} por ${usuario}`)

    return NextResponse.json(seguimiento, { status: 201 })
  } catch (error) {
    logger.error('Error creating seguimiento:', error)
    return NextResponse.json(
      { error: 'Error al crear seguimiento' },
      { status: 500 }
    )
  }
}

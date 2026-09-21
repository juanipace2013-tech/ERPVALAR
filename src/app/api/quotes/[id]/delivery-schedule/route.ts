import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { parseCivilDate } from '@/lib/date-helpers'

/**
 * PUT /api/quotes/[id]/delivery-schedule
 *
 * Reemplaza el cronograma de entregas parciales completo de la cotización.
 * Body: { tramos: Array<{ fecha: "YYYY-MM-DD", cantidad: number }> }
 *   - Lista vacía elimina el cronograma.
 *
 * Solo informativo para el tablero de facturación (alerta "no facturar
 * hasta X"): NO bloquea la facturación manual.
 */

const putSchema = z.object({
  tramos: z
    .array(
      z.object({
        fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)'),
        cantidad: z.number().positive('La cantidad debe ser mayor a 0'),
      })
    )
    .max(24, 'Máximo 24 tramos'),
})

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
    const parsed = putSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Body inválido', detalles: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const quote = await prisma.quote.findUnique({
      where: { id },
      select: { id: true, status: true },
    })
    if (!quote) {
      return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })
    }
    if (!['ACCEPTED', 'CONVERTED', 'FACTURADA_PARCIAL'].includes(quote.status)) {
      return NextResponse.json(
        { error: 'El cronograma de entregas solo aplica a cotizaciones aceptadas' },
        { status: 400 }
      )
    }

    const tramos = parsed.data.tramos.map((t) => ({
      quoteId: id,
      fecha: parseCivilDate(t.fecha),
      cantidad: t.cantidad,
    }))

    await prisma.$transaction([
      prisma.quoteDeliverySchedule.deleteMany({ where: { quoteId: id } }),
      ...(tramos.length > 0
        ? [prisma.quoteDeliverySchedule.createMany({ data: tramos })]
        : []),
    ])

    const saved = await prisma.quoteDeliverySchedule.findMany({
      where: { quoteId: id },
      orderBy: { fecha: 'asc' },
      select: { id: true, fecha: true, cantidad: true },
    })

    return NextResponse.json({ success: true, deliverySchedules: saved })
  } catch (error: unknown) {
    logger.error('Error updating delivery schedule:', error)
    const message =
      error instanceof Error ? error.message : 'Error al guardar cronograma de entregas'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

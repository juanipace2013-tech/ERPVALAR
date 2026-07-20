import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { recalcular } from '@/lib/comisiones/liquidacion'

const postSchema = z.object({
  concepto: z.string().min(1).max(200),
  montoArs: z.number(), // con signo: negativo resta del neto
})

// POST /api/comisiones/liquidaciones/[id]/ajustes — agrega un concepto manual
// (ej: "Deuda Germán" -100611) y recalcula el neto.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const parsed = postSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Body inválido', detalles: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const liquidacion = await prisma.comisionLiquidacion.findUnique({ where: { id } })
    if (!liquidacion) {
      return NextResponse.json({ error: 'Liquidación no encontrada' }, { status: 404 })
    }
    if (liquidacion.estado === 'CERRADA') {
      return NextResponse.json(
        { error: 'La liquidación está cerrada: reabrila para agregar ajustes' },
        { status: 400 }
      )
    }

    await prisma.comisionAjuste.create({
      data: { liquidacionId: id, ...parsed.data },
    })
    const actualizada = await recalcular(id)
    return NextResponse.json({ liquidacion: actualizada })
  } catch (e) {
    logger.error('[comisiones/ajustes] POST error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

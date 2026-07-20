import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { recalcular } from '@/lib/comisiones/liquidacion'

// GET /api/comisiones/liquidaciones/[id] — detalle completo.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const liquidacion = await prisma.comisionLiquidacion.findUnique({
      where: { id },
      include: {
        vendedor: { select: { id: true, name: true } },
        lineas: { orderBy: { createdAt: 'asc' } },
        ajustes: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!liquidacion) {
      return NextResponse.json({ error: 'Liquidación no encontrada' }, { status: 404 })
    }
    return NextResponse.json({ liquidacion })
  } catch (e) {
    logger.error('[comisiones/liquidaciones/[id]] GET error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

const patchSchema = z.object({
  basicoArs: z.number().nonnegative().optional(),
  efectivoArs: z.number().nullable().optional(),
  mlArs: z.number().nullable().optional(),
  notas: z.string().max(2000).nullable().optional(),
})

// PATCH /api/comisiones/liquidaciones/[id] — edita básico, split y notas.
// Solo sobre liquidaciones ABIERTAS (salvo el split efectivo/ML, que es un
// registro de cómo se pagó y se puede completar después del cierre).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const parsed = patchSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Body inválido', detalles: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const existente = await prisma.comisionLiquidacion.findUnique({ where: { id } })
    if (!existente) {
      return NextResponse.json({ error: 'Liquidación no encontrada' }, { status: 404 })
    }

    const { basicoArs, efectivoArs, mlArs, notas } = parsed.data
    if (existente.estado === 'CERRADA' && (basicoArs !== undefined || notas !== undefined)) {
      return NextResponse.json(
        { error: 'La liquidación está cerrada: solo se puede editar el split efectivo/ML' },
        { status: 400 }
      )
    }

    await prisma.comisionLiquidacion.update({
      where: { id },
      data: {
        ...(basicoArs !== undefined ? { basicoArs } : {}),
        ...(efectivoArs !== undefined ? { efectivoArs } : {}),
        ...(mlArs !== undefined ? { mlArs } : {}),
        ...(notas !== undefined ? { notas } : {}),
      },
    })

    const liquidacion =
      existente.estado === 'ABIERTA'
        ? await recalcular(id)
        : await prisma.comisionLiquidacion.findUnique({
            where: { id },
            include: { lineas: true, ajustes: true },
          })
    return NextResponse.json({ liquidacion })
  } catch (e) {
    logger.error('[comisiones/liquidaciones/[id]] PATCH error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

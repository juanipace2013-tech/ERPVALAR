import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { recalcular } from '@/lib/comisiones/liquidacion'

const postSchema = z.object({
  clienteNombre: z.string().min(1).max(200),
  numeroNota: z.string().max(50).optional(),
  montoUsd: z.number().positive(), // se guarda en negativo: la NC resta
})

// POST /api/comisiones/liquidaciones/[id]/lineas — agrega una NC manual como
// línea con importe USD negativo: resta de la comisión y del total facturado
// del mes (puede bajar el tramo de la escala). Para NC parciales o casos que
// la detección automática no matchea.
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
        { error: 'La liquidación está cerrada: reabrila para agregar una NC' },
        { status: 400 }
      )
    }

    const { clienteNombre, numeroNota, montoUsd } = parsed.data
    await prisma.comisionLinea.create({
      data: {
        vendedorId: liquidacion.vendedorId,
        liquidacionId: id,
        clienteNombre,
        presupuesto: 'NC',
        numeroFactura: numeroNota || null,
        importeFacturadoUsd: -montoUsd,
        anioImputacion: liquidacion.anio,
        mesImputacion: liquidacion.mes,
        estado: 'FACTURADO',
      },
    })
    const actualizada = await recalcular(id)
    return NextResponse.json({ liquidacion: actualizada })
  } catch (e) {
    logger.error('[comisiones/lineas] POST error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

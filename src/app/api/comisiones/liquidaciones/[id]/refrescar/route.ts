import { NextRequest, NextResponse } from 'next/server'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { abrirYSincronizar } from '@/lib/comisiones/liquidacion'

// POST /api/comisiones/liquidaciones/[id]/refrescar — re-sincroniza las
// líneas con las facturas parciales del mes (altas nuevas, anuladas afuera).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const existente = await prisma.comisionLiquidacion.findUnique({ where: { id } })
    if (!existente) {
      return NextResponse.json({ error: 'Liquidación no encontrada' }, { status: 404 })
    }
    if (existente.estado === 'CERRADA') {
      return NextResponse.json(
        { error: 'La liquidación está cerrada: reabrila para refrescar' },
        { status: 400 }
      )
    }

    const liquidacion = await abrirYSincronizar(existente.vendedorId, existente.anio, existente.mes)
    return NextResponse.json({ liquidacion })
  } catch (e) {
    logger.error('[comisiones/refrescar] POST error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

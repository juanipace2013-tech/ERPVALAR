import { NextRequest, NextResponse } from 'next/server'

import { auth } from '@/auth'
import { logger } from '@/lib/logger'
import { cerrar } from '@/lib/comisiones/liquidacion'

// POST /api/comisiones/liquidaciones/[id]/cerrar — recalcula y congela la
// tasa del mes en cada línea (tratamiento retroactivo del tramo).
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
    const liquidacion = await cerrar(id)
    return NextResponse.json({ liquidacion })
  } catch (e) {
    logger.error('[comisiones/cerrar] POST error', e)
    const mensaje = e instanceof Error ? e.message : 'Error interno'
    return NextResponse.json({ error: mensaje }, { status: 400 })
  }
}

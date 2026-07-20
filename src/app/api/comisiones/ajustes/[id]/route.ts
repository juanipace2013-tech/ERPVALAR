import { NextRequest, NextResponse } from 'next/server'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { recalcular } from '@/lib/comisiones/liquidacion'

// DELETE /api/comisiones/ajustes/[id] — elimina un ajuste y recalcula.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const ajuste = await prisma.comisionAjuste.findUnique({
      where: { id },
      include: { liquidacion: { select: { id: true, estado: true } } },
    })
    if (!ajuste) {
      return NextResponse.json({ error: 'Ajuste no encontrado' }, { status: 404 })
    }
    if (ajuste.liquidacion.estado === 'CERRADA') {
      return NextResponse.json(
        { error: 'La liquidación está cerrada: reabrila para eliminar ajustes' },
        { status: 400 }
      )
    }

    await prisma.comisionAjuste.delete({ where: { id } })
    const liquidacion = await recalcular(ajuste.liquidacion.id)
    return NextResponse.json({ liquidacion })
  } catch (e) {
    logger.error('[comisiones/ajustes/[id]] DELETE error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

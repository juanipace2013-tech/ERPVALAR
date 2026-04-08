import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

/**
 * DELETE /api/quotes/[id]/seguimientos/[seguimientoId]
 * Eliminar un seguimiento
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; seguimientoId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id, seguimientoId } = await params

    // Verificar que el seguimiento existe y pertenece a la cotización
    const seguimiento = await prisma.quoteSeguimiento.findFirst({
      where: { id: seguimientoId, quoteId: id },
    })

    if (!seguimiento) {
      return NextResponse.json(
        { error: 'Seguimiento no encontrado' },
        { status: 404 }
      )
    }

    await prisma.quoteSeguimiento.delete({
      where: { id: seguimientoId },
    })

    logger.info(`Seguimiento ${seguimientoId} eliminado de cotización ${id}`)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting seguimiento:', error)
    return NextResponse.json(
      { error: 'Error al eliminar seguimiento' },
      { status: 500 }
    )
  }
}

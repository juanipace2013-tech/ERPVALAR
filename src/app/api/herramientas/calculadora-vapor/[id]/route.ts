import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params

    const calculo = await prisma.calculoReguladoraVapor.findUnique({ where: { id } })
    if (!calculo) {
      return NextResponse.json({ error: 'Cálculo no encontrado' }, { status: 404 })
    }

    await prisma.calculoReguladoraVapor.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error('Error eliminando calculo reguladora vapor:', error)
    return NextResponse.json(
      { error: 'Error al eliminar el cálculo' },
      { status: 500 }
    )
  }
}

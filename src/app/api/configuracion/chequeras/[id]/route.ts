import { logger } from '@/lib/logger'
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requireRole, ROLES } from '@/lib/authz'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const forbidden = requireRole(session, ROLES.GESTION)
    if (forbidden) return forbidden

    const { id } = await params

    await prisma.bankCheckbook.delete({
      where: { id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting chequera:', error)
    return NextResponse.json(
      { error: 'Error al eliminar chequera' },
      { status: 500 }
    )
  }
}

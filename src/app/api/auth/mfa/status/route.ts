import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

// GET: Obtener estado de 2FA del usuario actual
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { mfaEnabled: true },
    })

    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    return NextResponse.json({ mfaEnabled: user.mfaEnabled })
  } catch (error) {
    logger.error('Error obteniendo estado MFA:', error)
    return NextResponse.json(
      { error: 'Error al obtener estado de 2FA' },
      { status: 500 }
    )
  }
}

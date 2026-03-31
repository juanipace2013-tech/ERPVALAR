import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { logger } from '@/lib/logger'

// POST: Desactivar 2FA (requiere contraseña para confirmar)
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { password } = await request.json()

    if (!password) {
      return NextResponse.json(
        { error: 'La contraseña es requerida para desactivar 2FA' },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { password: true, mfaEnabled: true },
    })

    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    if (!user.mfaEnabled) {
      return NextResponse.json({ error: '2FA no está activado' }, { status: 400 })
    }

    // Verificar contraseña
    const isPasswordValid = await bcrypt.compare(password, user.password)
    if (!isPasswordValid) {
      return NextResponse.json(
        { error: 'Contraseña incorrecta' },
        { status: 400 }
      )
    }

    // Desactivar 2FA
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error desactivando MFA:', error)
    return NextResponse.json(
      { error: 'Error al desactivar 2FA' },
      { status: 500 }
    )
  }
}

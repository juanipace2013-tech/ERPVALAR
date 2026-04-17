import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import * as OTPAuth from 'otpauth'
import { logger } from '@/lib/logger'
import { checkRateLimit, recordFailedAttempt, clearAttempts } from '@/lib/rate-limit'

// POST: Verificar código TOTP y activar 2FA
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const rateLimitKey = `mfa-setup:${session.user.id}`
    if (!(await checkRateLimit(rateLimitKey))) {
      return NextResponse.json(
        { error: 'Demasiados intentos. Intentá nuevamente en 15 minutos.' },
        { status: 429 }
      )
    }

    const { code } = await request.json()

    if (!code || typeof code !== 'string' || code.length !== 6) {
      return NextResponse.json(
        { error: 'El código debe ser de 6 dígitos' },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, mfaSecret: true, mfaEnabled: true },
    })

    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    if (user.mfaEnabled) {
      return NextResponse.json({ error: '2FA ya está activado' }, { status: 400 })
    }

    if (!user.mfaSecret) {
      return NextResponse.json(
        { error: 'Primero debes generar el QR code' },
        { status: 400 }
      )
    }

    // Verificar el código TOTP
    const totp = new OTPAuth.TOTP({
      issuer: 'ERP VAL ARG',
      label: user.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(user.mfaSecret),
    })

    const delta = totp.validate({ token: code, window: 1 })

    if (delta === null) {
      await recordFailedAttempt(rateLimitKey)
      return NextResponse.json(
        { error: 'Código incorrecto. Intentá de nuevo.' },
        { status: 400 }
      )
    }

    await clearAttempts(rateLimitKey)

    // Activar 2FA
    await prisma.user.update({
      where: { id: session.user.id },
      data: { mfaEnabled: true },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error verificando MFA:', error)
    return NextResponse.json(
      { error: 'Error al verificar código' },
      { status: 500 }
    )
  }
}

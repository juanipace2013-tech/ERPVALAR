import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'
import { logger } from '@/lib/logger'

// POST: Generar secreto TOTP y QR code para activar 2FA
export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, mfaEnabled: true },
    })

    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    if (user.mfaEnabled) {
      return NextResponse.json({ error: '2FA ya está activado' }, { status: 400 })
    }

    // Generar secreto TOTP
    const secret = new OTPAuth.Secret({ size: 20 })

    const totp = new OTPAuth.TOTP({
      issuer: 'ERP VAL ARG',
      label: user.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    })

    const otpauthUrl = totp.toString()

    // Generar QR code como data URL
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
      width: 256,
      margin: 2,
      color: {
        dark: '#1e40af',
        light: '#ffffff',
      },
    })

    // Guardar secreto temporalmente (no activar aún)
    await prisma.user.update({
      where: { id: session.user.id },
      data: { mfaSecret: secret.base32 },
    })

    return NextResponse.json({
      qrCode: qrCodeDataUrl,
      secret: secret.base32,
    })
  } catch (error) {
    logger.error('Error en MFA setup:', error)
    return NextResponse.json(
      { error: 'Error al configurar 2FA' },
      { status: 500 }
    )
  }
}

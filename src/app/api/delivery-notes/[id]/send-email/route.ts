import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { sendRemitoEmail } from '@/lib/email/send-remito-email'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Parsea un string con emails separados por , o ; */
function parseEmails(raw: string): string[] {
  return raw.split(/[,;]/).map((e) => e.trim()).filter(Boolean)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { email, message } = body

    // Validar que haya al menos un email
    if (!email || !email.trim()) {
      return NextResponse.json({ error: 'Email requerido' }, { status: 400 })
    }

    // Parsear y validar cada email
    const emails = parseEmails(email)
    if (emails.length === 0) {
      return NextResponse.json({ error: 'Email requerido' }, { status: 400 })
    }

    const invalid = emails.filter((e) => !EMAIL_REGEX.test(e))
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Email(s) inválido(s): ${invalid.join(', ')}` },
        { status: 400 }
      )
    }

    // Verificar que el remito existe
    const deliveryNote = await prisma.deliveryNote.findUnique({
      where: { id },
      include: { customer: true },
    })

    if (!deliveryNote) {
      return NextResponse.json({ error: 'Remito no encontrado' }, { status: 404 })
    }

    // Enviar email — primer email como TO, resto como CC
    const [primaryEmail, ...ccEmails] = emails

    const result = await sendRemitoEmail({
      deliveryNoteId: id,
      recipientEmail: primaryEmail,
      ccEmails: ccEmails.length > 0 ? ccEmails : undefined,
      message,
    })

    return NextResponse.json({
      message: emails.length === 1
        ? 'Email enviado correctamente'
        : `Email enviado a ${emails.length} destinatarios`,
      ...result,
    })
  } catch (error) {
    logger.error('Error enviando email de remito:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Error al enviar email',
      },
      { status: 500 }
    )
  }
}

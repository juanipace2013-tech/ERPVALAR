import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { sendRemitoEmail } from '@/lib/email/send-remito-email'
import { prisma } from '@/lib/prisma'

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

    // Validar email
    if (!email || !email.trim()) {
      return NextResponse.json({ error: 'Email requerido' }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Email inválido' }, { status: 400 })
    }

    // Verificar que el remito existe
    const deliveryNote = await prisma.deliveryNote.findUnique({
      where: { id },
      include: { customer: true },
    })

    if (!deliveryNote) {
      return NextResponse.json({ error: 'Remito no encontrado' }, { status: 404 })
    }

    // Enviar email
    const result = await sendRemitoEmail({
      deliveryNoteId: id,
      recipientEmail: email,
      message,
    })

    return NextResponse.json({
      success: true,
      message: 'Email enviado correctamente',
      ...result,
    })
  } catch (error) {
    console.error('Error enviando email de remito:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Error al enviar email',
      },
      { status: 500 }
    )
  }
}

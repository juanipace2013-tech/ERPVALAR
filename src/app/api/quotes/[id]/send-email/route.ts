import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { sendQuoteEmail } from '@/lib/email/send-quote-email';
import { updateQuoteStatus } from '@/lib/quote-workflow';
import { prisma } from '@/lib/prisma';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { email, message } = body;

    // Validar email
    if (!email || !email.trim()) {
      return NextResponse.json(
        { error: 'Email requerido' },
        { status: 400 }
      );
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Email inválido' },
        { status: 400 }
      );
    }

    // Buscar cotización
    const quote = await prisma.quote.findUnique({
      where: { id },
      include: { customer: true }
    });

    if (!quote) {
      return NextResponse.json(
        { error: 'Cotización no encontrada' },
        { status: 404 }
      );
    }

    // Cambiar estado a SENT si está en DRAFT
    if (quote.status === 'DRAFT') {
      await updateQuoteStatus(id, 'SENT', session.user.id);
    }

    // Enviar email
    const result = await sendQuoteEmail({
      quoteId: id,
      recipientEmail: email,
      message
    });

    return NextResponse.json({
      ...result,
      success: true,
      message: 'Email enviado correctamente',
    });

  } catch (error) {
    console.error('Error enviando email de cotización:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Error al enviar email',
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

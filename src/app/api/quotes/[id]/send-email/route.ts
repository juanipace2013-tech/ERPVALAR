import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { sendQuoteEmail } from '@/lib/email/send-quote-email';
import { updateQuoteStatus } from '@/lib/quote-workflow';
import { prisma } from '@/lib/prisma';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parsea un string con emails separados por , o ; */
function parseEmails(raw: string): string[] {
  return raw.split(/[,;]/).map((e) => e.trim()).filter(Boolean);
}

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

    // Validar que haya al menos un email
    if (!email || !email.trim()) {
      return NextResponse.json(
        { error: 'Email requerido' },
        { status: 400 }
      );
    }

    // Parsear y validar cada email
    const emails = parseEmails(email);
    if (emails.length === 0) {
      return NextResponse.json(
        { error: 'Email requerido' },
        { status: 400 }
      );
    }

    const invalid = emails.filter((e) => !EMAIL_REGEX.test(e));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Email(s) inválido(s): ${invalid.join(', ')}` },
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

    // Enviar email — primer email como TO, resto como CC
    const [primaryEmail, ...ccEmails] = emails;

    const result = await sendQuoteEmail({
      quoteId: id,
      recipientEmail: primaryEmail,
      ccEmails: ccEmails.length > 0 ? ccEmails : undefined,
      message
    });

    return NextResponse.json({
      success: true,
      message: emails.length === 1
        ? 'Email enviado correctamente'
        : `Email enviado a ${emails.length} destinatarios`,
      ...result
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

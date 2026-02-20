import { NextRequest, NextResponse } from 'next/server';
import { verifyPublicToken } from '@/lib/email/send-quote-email';
import { updateQuoteStatus } from '@/lib/quote-workflow';

/**
 * POST - Rechazar cotización usando token público
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const body = await request.json();
    const { rejectionReason } = body;

    // Validar motivo de rechazo
    if (!rejectionReason || !rejectionReason.trim()) {
      return NextResponse.json(
        { error: 'Debe proporcionar un motivo de rechazo' },
        { status: 400 }
      );
    }

    // Verificar token y obtener cotización
    const quote = await verifyPublicToken(token);

    // Verificar que esté en estado correcto
    if (quote.status !== 'SENT') {
      return NextResponse.json(
        { error: 'Esta cotización ya no puede ser rechazada' },
        { status: 400 }
      );
    }

    // Actualizar estado a REJECTED
    const updatedQuote = await updateQuoteStatus(
      quote.id,
      'REJECTED',
      'customer', // ID especial para indicar que fue el cliente
      {
        rejectionReason: rejectionReason.trim()
      }
    );

    return NextResponse.json({
      success: true,
      message: 'Cotización rechazada',
      quote: updatedQuote
    });

  } catch (error) {
    console.error('Error rechazando cotización:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al rechazar cotización' },
      { status: 500 }
    );
  }
}

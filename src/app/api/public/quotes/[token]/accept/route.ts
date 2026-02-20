import { NextRequest, NextResponse } from 'next/server';
import { verifyPublicToken } from '@/lib/email/send-quote-email';
import { updateQuoteStatus } from '@/lib/quote-workflow';

/**
 * POST - Aceptar cotización usando token público
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const body = await request.json();
    const { response } = body;

    // Verificar token y obtener cotización
    const quote = await verifyPublicToken(token);

    // Verificar que esté en estado correcto
    if (quote.status !== 'SENT') {
      return NextResponse.json(
        { error: 'Esta cotización ya no puede ser aceptada' },
        { status: 400 }
      );
    }

    // Actualizar estado a ACCEPTED
    const updatedQuote = await updateQuoteStatus(
      quote.id,
      'ACCEPTED',
      'customer', // ID especial para indicar que fue el cliente
      {
        customerResponse: response || 'Cliente aceptó la cotización desde el email'
      }
    );

    return NextResponse.json({
      success: true,
      message: 'Cotización aceptada exitosamente',
      quote: updatedQuote
    });

  } catch (error) {
    console.error('Error aceptando cotización:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al aceptar cotización' },
      { status: 500 }
    );
  }
}

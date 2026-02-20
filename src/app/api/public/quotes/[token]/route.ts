import { NextRequest, NextResponse } from 'next/server';
import { verifyPublicToken } from '@/lib/email/send-quote-email';

/**
 * GET - Obtener cotización usando token público
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const quote = await verifyPublicToken(token);

    // Serializar Decimals a números
    const serializedQuote = {
      ...quote,
      exchangeRate: quote.exchangeRate ? Number(quote.exchangeRate) : null,
      subtotal: Number(quote.subtotal),
      total: Number(quote.total),
      items: quote.items.map(item => ({
        ...item,
        listPrice: Number(item.listPrice),
        brandDiscount: Number(item.brandDiscount),
        customerMultiplier: Number(item.customerMultiplier),
        unitPrice: Number(item.unitPrice),
        totalPrice: Number(item.totalPrice)
      }))
    };

    return NextResponse.json(serializedQuote);
  } catch (error) {
    console.error('Error obteniendo cotización pública:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al obtener cotización' },
      { status: error instanceof Error && error.message === 'Token inválido' ? 404 : 500 }
    );
  }
}

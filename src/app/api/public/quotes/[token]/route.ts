import { NextRequest, NextResponse } from 'next/server';
import { verifyPublicToken } from '@/lib/email/send-quote-email';
import { logger } from '@/lib/logger'
import { importesPresentacion } from '@/lib/cotizacion-pesos'

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

    // Cotización presentada en pesos: el cliente ve los importes convertidos y
    // ninguna referencia al dólar (ni moneda ni tipo de cambio).
    const presentacion = importesPresentacion(quote, serializedQuote.items);
    if (presentacion.moneda === 'ARS' && quote.currency === 'USD') {
      return NextResponse.json({
        ...serializedQuote,
        currency: 'ARS',
        exchangeRate: null,
        items: presentacion.items,
        subtotal: presentacion.subtotal,
        total: presentacion.total,
      });
    }

    return NextResponse.json(serializedQuote);
  } catch (error) {
    logger.error('Error obteniendo cotización pública:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al obtener cotización' },
      { status: error instanceof Error && error.message === 'Token inválido' ? 404 : 500 }
    );
  }
}

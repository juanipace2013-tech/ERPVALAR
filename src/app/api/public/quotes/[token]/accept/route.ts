import { NextRequest, NextResponse } from 'next/server';
import { verifyPublicToken } from '@/lib/email/send-quote-email';
import { updateQuoteStatus } from '@/lib/quote-workflow';
import { sendMail } from '@/lib/email/microsoft-graph';
import { logger } from '@/lib/logger'

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

    // Notificar al vendedor por email en background: el estado ya se persistió
    // y el cliente final no necesita esperar los round-trips a Graph.
    {
      const customerName = quote.customer?.name || 'Cliente';
      const customerCuit = quote.customer?.cuit || 'N/A';
      const totalFormatted = Number(quote.total).toLocaleString('es-AR', { minimumFractionDigits: 2 });
      const dateFormatted = new Date(quote.date).toLocaleDateString('es-AR');
      const quoteUrl = `https://crm.val-ar.com.ar/cotizaciones/${quote.id}`;

      sendMail({
        to: quote.salesPerson.email,
        cc: 'stejedor@val-ar.com.ar',
        subject: `✅ Cotización ${quote.quoteNumber} ACEPTADA por ${customerName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h2 style="color: #16a34a;">✅ Cotización Aceptada</h2>
            <p>El cliente <strong>${customerName}</strong> aceptó la cotización.</p>
            <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Cotización</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${quote.quoteNumber}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Cliente</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${customerName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">CUIT</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${customerCuit}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Monto</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${quote.currency} ${totalFormatted}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Fecha</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${dateFormatted}</td></tr>
            </table>
            <p><strong>Procedé con la gestión de compras.</strong></p>
            <p><a href="${quoteUrl}" style="display: inline-block; padding: 10px 20px; background-color: #16a34a; color: white; text-decoration: none; border-radius: 6px;">Ver Cotización</a></p>
          </div>
        `,
      }).catch((emailError) => {
        logger.error('Error enviando email de notificación de aceptación:', emailError);
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Cotización aceptada exitosamente',
      quote: updatedQuote
    });

  } catch (error) {
    logger.error('Error aceptando cotización:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al aceptar cotización' },
      { status: 500 }
    );
  }
}

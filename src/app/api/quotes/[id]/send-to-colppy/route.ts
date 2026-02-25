/**
 * Endpoint API: POST /api/quotes/[id]/send-to-colppy
 * Envía una cotización a Colppy (remito, factura, o ambos)
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { sendQuoteToColppy, type SendToColppyOptions } from '@/lib/colppy';
import { QuoteStatus } from '@prisma/client';

// ============================================================================
// TIPOS
// ============================================================================

interface EditableItem {
  id: string;
  sku: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  iva: number;
  comentario: string;
}

interface SendToColppyRequest {
  action: 'remito' | 'factura-cuenta-corriente' | 'factura-contado' | 'remito-factura';
  editedData?: {
    items: EditableItem[];
    condicionPago: string;
    puntoVenta: string;
    descripcion: string;
  };
}

// ============================================================================
// HANDLER POST
// ============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Autenticación
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      );
    }

    // 2. Obtener parámetros
    const { id } = await params;

    // 3. Parsear body
    const body = await request.json() as SendToColppyRequest;
    const { action, editedData } = body;

    // 4. Validar acción
    const validActions: SendToColppyRequest['action'][] = [
      'remito',
      'factura-cuenta-corriente',
      'factura-contado',
      'remito-factura',
    ];

    if (!action || !validActions.includes(action)) {
      return NextResponse.json(
        { error: 'Acción inválida. Debe ser: remito, factura-cuenta-corriente, factura-contado, o remito-factura' },
        { status: 400 }
      );
    }

    // 5. Buscar cotización con includes
    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        customer: true,
        items: {
          include: {
            product: true,
            additionals: {
              include: {
                product: true,
              },
            },
          },
          orderBy: {
            itemNumber: 'asc',
          },
        },
      },
    });

    if (!quote) {
      return NextResponse.json(
        { error: 'Cotización no encontrada' },
        { status: 404 }
      );
    }

    // 5. Validar estado = ACCEPTED
    if (quote.status !== QuoteStatus.ACCEPTED) {
      return NextResponse.json(
        { error: `La cotización debe estar en estado ACCEPTED (actual: ${quote.status})` },
        { status: 400 }
      );
    }

    // 6. Validar que no haya sido enviada previamente
    if (action.includes('remito') && quote.colppyDeliveryNoteId) {
      return NextResponse.json(
        { error: 'Esta cotización ya tiene un remito asociado en Colppy' },
        { status: 409 }
      );
    }

    if (action.includes('factura') && quote.colppyInvoiceId) {
      return NextResponse.json(
        { error: 'Esta cotización ya tiene una factura asociada en Colppy' },
        { status: 409 }
      );
    }

    // 7. Validar exchangeRate si currency = USD
    if (quote.currency === 'USD' && !quote.exchangeRate) {
      return NextResponse.json(
        { error: 'La cotización en USD debe tener un tipo de cambio definido' },
        { status: 400 }
      );
    }

    // 8. Preparar datos para Colppy
    // Usar datos editados si están disponibles, si no usar los originales
    const quoteData = {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      currency: quote.currency,
      exchangeRate: quote.exchangeRate ? Number(quote.exchangeRate) : null,
      customer: {
        name: quote.customer.name,
        cuit: quote.customer.cuit,
        taxCondition: quote.customer.taxCondition,
        address: quote.customer.address || undefined,
        phone: quote.customer.phone || undefined,
        email: quote.customer.email || undefined,
      },
      items: editedData?.items.map((item) => ({
        productName: item.descripcion,
        productSku: item.sku,
        quantity: item.cantidad,
        unitPrice: item.precioUnitario,
        iva: item.iva,
        comentario: item.comentario,
        deliveryTime: undefined,
        additionals: [],
      })) || quote.items.map((item) => ({
        productName: item.product.name,
        productSku: item.product.sku,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        iva: 21,
        comentario: `Cotización ${quote.quoteNumber}${quote.notes ? ' / ' + quote.notes : ''}`,
        deliveryTime: item.deliveryTime || undefined,
        additionals: item.additionals.map((additional) => ({
          name: additional.product.name,
          unitPrice: Number(additional.listPrice),
        })),
      })),
    };

    // 9. Llamar a sendQuoteToColppy
    const options: SendToColppyOptions = {
      action,
      condicionPago: editedData?.condicionPago,
      puntoVenta: editedData?.puntoVenta,
      descripcion: editedData?.descripcion,
    };
    const result = await sendQuoteToColppy(options, quoteData);

    // 10. Verificar resultado
    if (!result.success) {
      return NextResponse.json(
        { error: `Error al enviar a Colppy: ${result.error}` },
        { status: 500 }
      );
    }

    // 11. Actualizar Quote con IDs de Colppy
    const updateData: any = {
      colppySyncedAt: new Date(),
      status: QuoteStatus.CONVERTED,
      statusUpdatedAt: new Date(),
      statusUpdatedBy: session.user.id,
    };

    if (result.remitoId) {
      updateData.colppyDeliveryNoteId = result.remitoId;
    }

    if (result.facturaId) {
      updateData.colppyInvoiceId = result.facturaId;
    }

    await prisma.quote.update({
      where: { id: quote.id },
      data: updateData,
    });

    // 12. Crear registro en QuoteStatusHistory
    await prisma.quoteStatusHistory.create({
      data: {
        quoteId: quote.id,
        fromStatus: QuoteStatus.ACCEPTED,
        toStatus: QuoteStatus.CONVERTED,
        changedBy: session.user.id,
        notes: `Enviado a Colppy: ${action}. ${result.remitoNumber ? `Remito: ${result.remitoNumber}` : ''} ${result.facturaNumber ? `Factura: ${result.facturaNumber}` : ''}`,
      },
    });

    // 13. Retornar resultado
    return NextResponse.json({
      success: true,
      message: 'Cotización enviada a Colppy exitosamente',
      remitoId: result.remitoId,
      remitoNumber: result.remitoNumber,
      facturaId: result.facturaId,
      facturaNumber: result.facturaNumber,
    });
  } catch (error: any) {
    console.error('Error en POST /api/quotes/[id]/send-to-colppy:', error);

    return NextResponse.json(
      { error: error.message || 'Error interno del servidor' },
      { status: 500 }
    );
  }
}

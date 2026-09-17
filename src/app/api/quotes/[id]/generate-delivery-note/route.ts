import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { generateDeliveryNoteFromQuote } from '@/lib/quote-workflow';
import { logger } from '@/lib/logger'

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
    const {
      deliveryAddress,
      deliveryCity,
      deliveryProvince,
      deliveryPostalCode,
      carrier,
      transportAddress,
      deliveryType,
      purchaseOrder,
      customerInvoiceNumber,
      bultos,
      notes,
      cotizacionFacturaId,
      items,
    } = body;

    // Selección manual de items del remito (opcional): validar la forma
    const selectedItems = Array.isArray(items)
      ? items
          .filter((i: unknown): i is { quoteItemId: string; quantity: number } => {
            const it = i as { quoteItemId?: unknown; quantity?: unknown };
            return typeof it?.quoteItemId === 'string' && Number(it?.quantity) > 0;
          })
          .map((i) => ({ quoteItemId: i.quoteItemId, quantity: Number(i.quantity) }))
      : undefined;

    const deliveryNote = await generateDeliveryNoteFromQuote(id, {
      deliveryAddress,
      deliveryCity,
      deliveryProvince,
      deliveryPostalCode,
      carrier,
      transportAddress,
      deliveryType,
      purchaseOrder,
      customerInvoiceNumber,
      bultos,
      notes,
      cotizacionFacturaId,
      items: selectedItems,
    });

    return NextResponse.json(deliveryNote, { status: 201 });
  } catch (error) {
    logger.error('Error generating delivery note:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al generar remito' },
      { status: 500 }
    );
  }
}

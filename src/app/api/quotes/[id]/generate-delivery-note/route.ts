import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { generateDeliveryNoteFromQuote } from '@/lib/quote-workflow';

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
      purchaseOrder,
      bultos,
      totalAmountARS,
      exchangeRate,
      notes
    } = body;

    const deliveryNote = await generateDeliveryNoteFromQuote(id, {
      deliveryAddress,
      deliveryCity,
      deliveryProvince,
      deliveryPostalCode,
      carrier,
      transportAddress,
      purchaseOrder,
      bultos,
      totalAmountARS,
      exchangeRate,
      notes
    });

    return NextResponse.json(deliveryNote, { status: 201 });
  } catch (error) {
    console.error('Error generating delivery note:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al generar remito' },
      { status: 500 }
    );
  }
}

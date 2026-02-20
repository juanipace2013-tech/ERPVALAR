import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { createPurchaseCreditNote } from '@/lib/credit-note-accounting';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const { creditNoteNumber, creditNoteDate, items } = body;

    // Validations
    if (!creditNoteNumber) {
      return NextResponse.json(
        { error: 'Número de nota de crédito es requerido' },
        { status: 400 }
      );
    }

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'Debe seleccionar al menos un item para devolver' },
        { status: 400 }
      );
    }

    // Create credit note
    const result = await createPurchaseCreditNote({
      originalInvoiceId: id,
      creditNoteNumber,
      creditNoteDate: creditNoteDate ? new Date(creditNoteDate) : new Date(),
      items: items.map((item: any) => ({
        originalItemId: item.originalItemId,
        quantity: Number(item.quantity),
        reason: item.reason,
      })),
      userId: session.user.id,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error('Error creating credit note:', error);
    return NextResponse.json(
      { error: error.message || 'Error al crear nota de crédito' },
      { status: 500 }
    );
  }
}

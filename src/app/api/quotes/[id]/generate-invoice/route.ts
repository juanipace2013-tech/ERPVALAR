import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { generateInvoiceFromQuote } from '@/lib/quote-workflow';

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
    const { pointOfSale, dueDate, notes } = body;

    const invoice = await generateInvoiceFromQuote(
      id,
      session.user.id,
      {
        pointOfSale,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        notes
      }
    );

    return NextResponse.json(invoice, { status: 201 });
  } catch (error) {
    console.error('Error generating invoice:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al generar factura' },
      { status: 500 }
    );
  }
}

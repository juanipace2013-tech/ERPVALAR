import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { updateQuoteStatus } from '@/lib/quote-workflow';
import { QuoteStatus } from '@prisma/client';

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
    const { status, customerResponse, rejectionReason } = body;

    if (!status) {
      return NextResponse.json(
        { error: 'Estado requerido' },
        { status: 400 }
      );
    }

    // Validar que el estado sea válido
    const validStatuses = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'CONVERTED'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: 'Estado inválido' },
        { status: 400 }
      );
    }

    const updatedQuote = await updateQuoteStatus(
      id,
      status as QuoteStatus,
      session.user.id,
      {
        customerResponse,
        rejectionReason
      }
    );

    return NextResponse.json(updatedQuote);
  } catch (error) {
    console.error('Error updating quote status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al actualizar estado' },
      { status: 500 }
    );
  }
}

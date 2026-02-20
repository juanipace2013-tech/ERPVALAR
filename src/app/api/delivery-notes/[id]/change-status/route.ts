import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { updateDeliveryNoteStatus } from '@/lib/quote-workflow';
import { DeliveryNoteStatus } from '@prisma/client';

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
    const { status, deliveryDate, receivedBy, notes } = body;

    if (!status) {
      return NextResponse.json(
        { error: 'Estado requerido' },
        { status: 400 }
      );
    }

    // Validar que el estado sea válido
    const validStatuses = ['PENDING', 'PREPARING', 'READY', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: 'Estado inválido' },
        { status: 400 }
      );
    }

    const updatedDeliveryNote = await updateDeliveryNoteStatus(
      id,
      status as DeliveryNoteStatus,
      {
        deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
        receivedBy,
        notes
      }
    );

    return NextResponse.json(updatedDeliveryNote);
  } catch (error) {
    console.error('Error updating delivery note status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al actualizar estado' },
      { status: 500 }
    );
  }
}

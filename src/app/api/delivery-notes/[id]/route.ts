import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;

    const deliveryNote = await prisma.deliveryNote.findUnique({
      where: { id },
      include: {
        customer: true,
        quote: {
          include: {
            items: {
              include: {
                product: true
              }
            }
          }
        },
        items: {
          include: {
            product: true
          }
        },
        invoices: true
      }
    });

    if (!deliveryNote) {
      return NextResponse.json(
        { error: 'Remito no encontrado' },
        { status: 404 }
      );
    }

    return NextResponse.json(deliveryNote);
  } catch (error) {
    console.error('Error fetching delivery note:', error);
    return NextResponse.json(
      { error: 'Error al cargar remito' },
      { status: 500 }
    );
  }
}

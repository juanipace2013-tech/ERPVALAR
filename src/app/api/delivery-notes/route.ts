import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const customerId = searchParams.get('customerId');
    const search = searchParams.get('search');

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (customerId) {
      where.customerId = customerId;
    }

    if (search) {
      where.OR = [
        { deliveryNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const deliveryNotes = await prisma.deliveryNote.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            cuit: true,
          },
        },
        quote: {
          select: {
            id: true,
            quoteNumber: true,
          },
        },
        items: {
          select: {
            id: true,
            quantity: true,
          },
        },
        invoices: {
          select: {
            id: true,
            invoiceNumber: true,
          },
        },
      },
      orderBy: {
        date: 'desc',
      },
    });

    return NextResponse.json(deliveryNotes);
  } catch (error) {
    console.error('Error fetching delivery notes:', error);
    return NextResponse.json(
      { error: 'Error al cargar remitos' },
      { status: 500 }
    );
  }
}

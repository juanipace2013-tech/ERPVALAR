import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

    // Obtener la cotización original con todos sus items y adicionales
    const originalQuote = await prisma.quote.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            additionals: true,
          },
        },
      },
    });

    if (!originalQuote) {
      return NextResponse.json(
        { error: 'Cotización no encontrada' },
        { status: 404 }
      );
    }

    // Obtener el siguiente número de cotización
    const lastQuote = await prisma.quote.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { quoteNumber: true },
    });

    const currentYear = new Date().getFullYear();
    let nextNumber = 1;

    if (lastQuote?.quoteNumber) {
      const match = lastQuote.quoteNumber.match(/VAL-(\d{4})-(\d{3})/);
      if (match) {
        const year = parseInt(match[1]);
        const number = parseInt(match[2]);
        if (year === currentYear) {
          nextNumber = number + 1;
        }
      }
    }

    const newQuoteNumber = `VAL-${currentYear}-${String(nextNumber).padStart(3, '0')}`;

    // Crear la nueva cotización duplicada
    const newQuote = await prisma.quote.create({
      data: {
        quoteNumber: newQuoteNumber,
        customerId: originalQuote.customerId,
        salesPersonId: originalQuote.salesPersonId,
        opportunityId: originalQuote.opportunityId,
        status: 'DRAFT',
        currency: originalQuote.currency,
        exchangeRate: originalQuote.exchangeRate,
        multiplier: originalQuote.multiplier,
        bonification: originalQuote.bonification,
        subtotal: originalQuote.subtotal,
        total: originalQuote.total,
        validUntil: originalQuote.validUntil,
        terms: originalQuote.terms,
        notes: originalQuote.notes,
        items: {
          create: originalQuote.items.map((item) => ({
            itemNumber: item.itemNumber,
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            listPrice: item.listPrice,
            brandDiscount: item.brandDiscount,
            customerMultiplier: item.customerMultiplier,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            deliveryTime: item.deliveryTime,
            isAlternative: item.isAlternative,
            additionals: {
              create: item.additionals.map((additional) => ({
                productId: additional.productId,
                position: additional.position,
                listPrice: additional.listPrice,
              })),
            },
          })),
        },
      },
    });

    return NextResponse.json(newQuote, { status: 201 });
  } catch (error) {
    console.error('Error duplicating quote:', error);
    return NextResponse.json(
      { error: 'Error al duplicar cotización' },
      { status: 500 }
    );
  }
}

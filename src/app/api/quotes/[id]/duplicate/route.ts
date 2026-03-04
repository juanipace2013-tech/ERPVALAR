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

    // Leer body opcional (puede tener colppyCustomer para duplicar con otro cliente)
    let body: { colppyCustomer?: any } = {};
    try {
      body = await request.json();
    } catch {
      // Body vacío = duplicar con mismo cliente
    }

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

    // Si se envió un cliente diferente, resolver su customerId
    let targetCustomerId = originalQuote.customerId;
    let newMultiplier = originalQuote.multiplier;

    if (body.colppyCustomer) {
      const colppyCustomer = body.colppyCustomer;

      const existingCustomer = await prisma.customer.findFirst({
        where: { cuit: colppyCustomer.cuit },
      });

      if (existingCustomer) {
        await prisma.customer.update({
          where: { id: existingCustomer.id },
          data: {
            name: colppyCustomer.name,
            businessName: colppyCustomer.businessName,
            taxCondition: colppyCustomer.taxCondition,
            email: colppyCustomer.email || existingCustomer.email,
            phone: colppyCustomer.phone || existingCustomer.phone,
            mobile: colppyCustomer.mobile || existingCustomer.mobile,
            address: colppyCustomer.address || existingCustomer.address,
            city: colppyCustomer.city || existingCustomer.city,
            province: colppyCustomer.province || existingCustomer.province,
            postalCode: colppyCustomer.postalCode || existingCustomer.postalCode,
            balance: colppyCustomer.saldo || existingCustomer.balance,
          },
        });
        targetCustomerId = existingCustomer.id;
        newMultiplier = existingCustomer.priceMultiplier;
      } else {
        const newCustomer = await prisma.customer.create({
          data: {
            name: colppyCustomer.name,
            businessName: colppyCustomer.businessName,
            cuit: colppyCustomer.cuit,
            taxCondition: colppyCustomer.taxCondition,
            email: colppyCustomer.email || null,
            phone: colppyCustomer.phone || null,
            mobile: colppyCustomer.mobile || null,
            address: colppyCustomer.address || null,
            city: colppyCustomer.city || null,
            province: colppyCustomer.province || null,
            postalCode: colppyCustomer.postalCode || null,
            priceMultiplier: colppyCustomer.priceMultiplier || 1.0,
            balance: colppyCustomer.saldo || 0,
            status: 'ACTIVE',
            type: 'BUSINESS',
          },
        });
        targetCustomerId = newCustomer.id;
        newMultiplier = newCustomer.priceMultiplier;
      }
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
        customerId: targetCustomerId,
        salesPersonId: originalQuote.salesPersonId,
        opportunityId: originalQuote.opportunityId,
        status: 'DRAFT',
        currency: originalQuote.currency,
        exchangeRate: originalQuote.exchangeRate,
        multiplier: newMultiplier,
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
                description: additional.description,
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

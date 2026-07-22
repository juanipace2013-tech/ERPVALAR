import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeCuit, buildCuitWhereClause } from '@/lib/cuit-utils';
import { logger } from '@/lib/logger'
import { generateNextQuoteNumber } from '@/lib/quotes/generate-quote-number'
import { getBCRAUSDRate } from '@/lib/bcra'

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

      const normalizedCuit = normalizeCuit(colppyCustomer.cuit);
      const existingCustomer = normalizedCuit
        ? await prisma.customer.findFirst({ where: buildCuitWhereClause(normalizedCuit) })
        : null;

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
            cuit: normalizedCuit || colppyCustomer.cuit,
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

    // Vigencia: hoy + 5 días, igual que una cotización nueva
    const newValidUntil = new Date();
    newValidUntil.setDate(newValidUntil.getDate() + 5);

    // Tipo de cambio actual: primero el vigente en la DB, sino el del BCRA.
    // Si ambos fallan, se mantiene el de la cotización original.
    let newExchangeRate = Number(originalQuote.exchangeRate);
    const now = new Date();
    const currentRate = await prisma.exchangeRate.findFirst({
      where: {
        fromCurrency: 'USD',
        toCurrency: 'ARS',
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gte: now } }],
      },
      orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
    });

    if (currentRate) {
      newExchangeRate = Number(currentRate.rate);
    } else {
      try {
        const bcraData = await getBCRAUSDRate();
        newExchangeRate = bcraData.rate;
      } catch (e) {
        logger.error('Error obteniendo TC del BCRA al duplicar cotización:', e);
      }
    }

    const newQuote = await prisma.$transaction(async (tx) => {
      const newQuoteNumber = await generateNextQuoteNumber(tx);

      const quote = await tx.quote.create({
        data: {
          quoteNumber: newQuoteNumber,
          customerId: targetCustomerId,
          salesPersonId: originalQuote.salesPersonId,
          opportunityId: originalQuote.opportunityId,
          status: 'DRAFT',
          currency: originalQuote.currency,
          exchangeRate: newExchangeRate,
          multiplier: newMultiplier,
          bonification: originalQuote.bonification,
          subtotal: originalQuote.subtotal,
          total: originalQuote.total,
          pricesIncludeTax: originalQuote.pricesIncludeTax,
          validUntil: newValidUntil,
          terms: originalQuote.terms,
          notes: originalQuote.notes,
        },
      });

      const itemsData = originalQuote.items.map((item) => ({
        quoteId: quote.id,
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
      }));

      const createdItems = await tx.quoteItem.createManyAndReturn({
        data: itemsData,
        select: { id: true },
      });

      const additionalsData = originalQuote.items.flatMap((item, idx) =>
        item.additionals.map((additional) => ({
          quoteItemId: createdItems[idx].id,
          productId: additional.productId,
          description: additional.description,
          position: additional.position,
          listPrice: additional.listPrice,
        }))
      );

      if (additionalsData.length > 0) {
        await tx.quoteItemAdditional.createMany({ data: additionalsData });
      }

      return quote;
    }, { maxWait: 10000, timeout: 30000 });

    return NextResponse.json(newQuote, { status: 201 });
  } catch (error) {
    logger.error('Error duplicating quote:', error);
    return NextResponse.json(
      { error: 'Error al duplicar cotización' },
      { status: 500 }
    );
  }
}

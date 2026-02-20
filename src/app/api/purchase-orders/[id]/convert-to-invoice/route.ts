import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

    const {
      voucherType,
      invoiceType = 'FA',
      pointOfSale,
      invoiceNumberSuffix,
      invoiceDate,
      dueDate,
      cae,
      caeExpirationDate,
      paymentTerms,
      generalDiscount = 0,
    } = body;

    // Get purchase order
    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!purchaseOrder) {
      return NextResponse.json(
        { error: 'Orden de compra no encontrada' },
        { status: 404 }
      );
    }

    // Validations
    if (!voucherType || !pointOfSale || !invoiceNumberSuffix) {
      return NextResponse.json(
        { error: 'Datos de factura incompletos' },
        { status: 400 }
      );
    }

    // Calculate totals from purchase order items
    let subtotal = 0;
    let taxAmount = 0;

    purchaseOrder.items.forEach((item) => {
      const itemSubtotal = Number(item.quantity) * Number(item.unitCost);
      const itemDiscount = itemSubtotal * (Number(item.discount) / 100);
      const itemNet = itemSubtotal - itemDiscount;
      const itemTax = itemNet * (Number(item.taxRate) / 100);

      subtotal += itemSubtotal;
      taxAmount += itemTax;
    });

    // Apply general discount
    const discountAmount = subtotal * (Number(generalDiscount) / 100);
    const netAmount = subtotal - discountAmount;

    // Recalculate tax on net amount
    taxAmount = 0;
    purchaseOrder.items.forEach((item) => {
      const itemProportion = (Number(item.quantity) * Number(item.unitCost)) / subtotal;
      const itemNet = netAmount * itemProportion;
      const itemTax = itemNet * (Number(item.taxRate) / 100);
      taxAmount += itemTax;
    });

    const total = netAmount + taxAmount;

    const invoiceNumber = `${voucherType}${pointOfSale}-${invoiceNumberSuffix}`;

    // Create purchase invoice
    const purchaseInvoice = await prisma.purchaseInvoice.create({
      data: {
        invoiceNumber,
        supplierId: purchaseOrder.supplierId,
        purchaseOrderId: purchaseOrder.id,
        voucherType,
        invoiceType,
        invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
        dueDate: dueDate ? new Date(dueDate) : new Date(),
        pointOfSale,
        invoiceNumberSuffix,
        cae: cae || null,
        caeExpirationDate: caeExpirationDate ? new Date(caeExpirationDate) : null,
        paymentTerms,
        generalDiscount: Number(generalDiscount),
        subtotal,
        discountAmount,
        netAmount,
        taxAmount,
        perceptionsAmount: 0,
        total,
        balance: total,
        currency: purchaseOrder.currency,
        status: 'PENDING',
        createdBy: session.user.id,
        items: {
          create: purchaseOrder.items.map((item) => {
            const itemSubtotal = Number(item.quantity) * Number(item.unitCost);
            const itemProportion = itemSubtotal / subtotal;
            const itemDiscounted = netAmount * itemProportion;
            const itemTax = itemDiscounted * (Number(item.taxRate) / 100);

            return {
              productId: item.productId,
              description: item.description || item.product?.name || '',
              unit: 'UN',
              quantity: item.quantity,
              listPrice: item.unitCost,
              discountPercent: Number(generalDiscount),
              unitPrice: item.unitCost,
              subtotal: itemDiscounted,
              taxRate: item.taxRate,
              taxAmount: itemTax,
              total: itemDiscounted + itemTax,
            };
          }),
        },
      },
      include: {
        supplier: true,
        items: {
          include: {
            product: true,
          },
        },
        purchaseOrder: true,
      },
    });

    return NextResponse.json(purchaseInvoice, { status: 201 });
  } catch (error: any) {
    console.error('Error converting purchase order to invoice:', error);
    return NextResponse.json(
      { error: error.message || 'Error al convertir orden en factura' },
      { status: 500 }
    );
  }
}

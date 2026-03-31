import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const supplierId = searchParams.get('supplierId');
    const search = searchParams.get('search');

    const page = parseInt(searchParams.get('page') || '0');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');
    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (supplierId) {
      where.supplierId = supplierId;
    }

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [purchaseInvoices, totalCount] = await Promise.all([
      prisma.purchaseInvoice.findMany({
        where,
        include: {
          supplier: {
            select: {
              id: true,
              name: true,
              taxId: true,
            },
          },
          items: {
            select: {
              id: true,
              quantity: true,
              total: true,
            },
          },
        },
        orderBy: {
          invoiceDate: 'desc',
        },
        take: pageSize,
        skip: page * pageSize,
      }),
      prisma.purchaseInvoice.count({ where }),
    ]);

    return NextResponse.json({ purchaseInvoices, totalCount, page, pageSize });
  } catch (error) {
    logger.error('Error fetching purchase invoices:', error);
    return NextResponse.json(
      { error: 'Error al cargar facturas de compra' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const {
      supplierId,
      voucherType,
      invoiceType,
      invoiceDate,
      dueDate,
      pointOfSale,
      invoiceNumberSuffix,
      cae,
      caeExpirationDate,
      paymentTerms,
      generalDiscount,
      description,
      internalNotes,
      items,
      taxes,
      perceptions,
    } = body;

    // Calcular totales
    let subtotal = 0;
    let netAmount = 0;
    let taxAmount = 0;
    let perceptionsAmount = 0;

    // Calcular subtotal de items
    items.forEach((item: any) => {
      subtotal += Number(item.listPrice) * Number(item.quantity);
    });

    // Calcular descuento
    const discountAmount = subtotal * (generalDiscount / 100);
    netAmount = subtotal - discountAmount;

    // Calcular IVA
    items.forEach((item: any) => {
      const itemNetAmount = (Number(item.listPrice) * Number(item.quantity)) * (1 - generalDiscount / 100);
      taxAmount += itemNetAmount * (Number(item.taxRate) / 100);
    });

    // Calcular percepciones
    if (perceptions) {
      perceptions.forEach((perception: any) => {
        perceptionsAmount += Number(perception.amount);
      });
    }

    const total = netAmount + taxAmount + perceptionsAmount;
    const invoiceNumber = `${voucherType}${pointOfSale}-${invoiceNumberSuffix}`;

    // Crear factura de compra
    const purchaseInvoice = await prisma.purchaseInvoice.create({
      data: {
        invoiceNumber,
        supplierId,
        voucherType,
        invoiceType: invoiceType || 'FA',
        invoiceDate: new Date(invoiceDate + 'T12:00:00Z'),
        receiptDate: new Date(),
        dueDate: new Date(dueDate + 'T12:00:00Z'),
        pointOfSale,
        invoiceNumberSuffix,
        cae,
        caeExpirationDate: caeExpirationDate ? new Date(caeExpirationDate + 'T12:00:00Z') : null,
        paymentTerms,
        generalDiscount: generalDiscount || 0,
        subtotal,
        discountAmount,
        netAmount,
        taxAmount,
        perceptionsAmount,
        total,
        balance: total,
        status: 'PENDING',
        description,
        internalNotes,
        createdBy: session.user.id,
        items: {
          create: items.map((item: any) => {
            const itemSubtotal = Number(item.listPrice) * Number(item.quantity);
            const itemNetAmount = itemSubtotal * (1 - generalDiscount / 100);
            const itemTaxAmount = itemNetAmount * (Number(item.taxRate) / 100);

            return {
              productId: item.productId || null,
              supplierProductCode: item.supplierProductCode,
              description: item.description,
              unit: item.unit || 'UN',
              quantity: item.quantity,
              listPrice: item.listPrice,
              discountPercent: generalDiscount,
              unitPrice: Number(item.listPrice) * (1 - generalDiscount / 100),
              subtotal: itemNetAmount,
              taxRate: item.taxRate,
              taxAmount: itemTaxAmount,
              total: itemNetAmount + itemTaxAmount,
              accountId: item.accountId || null,
              batchNumber: item.batchNumber || null,
              expirationDate: item.expirationDate ? new Date(item.expirationDate + 'T12:00:00Z') : null,
              importInfo: item.importInfo || null,
            };
          }),
        },
        taxes: taxes ? {
          create: taxes.map((tax: any) => ({
            taxType: tax.taxType,
            rate: tax.rate,
            baseAmount: tax.baseAmount,
            taxAmount: tax.taxAmount,
          })),
        } : undefined,
        perceptions: perceptions ? {
          create: perceptions.map((perception: any) => ({
            jurisdiction: perception.jurisdiction,
            perceptionType: perception.perceptionType,
            regulation: perception.regulation || null,
            rate: perception.rate,
            baseAmount: perception.baseAmount,
            amount: perception.amount,
            accountId: perception.accountId || null,
          })),
        } : undefined,
      },
      include: {
        supplier: true,
        items: {
          include: {
            product: true,
          },
        },
        taxes: true,
        perceptions: true,
      },
    });

    // Auto-vincular items por código de proveedor → SKU del catálogo (batch)
    let autoLinkedCount = 0
    const unlinkItems = purchaseInvoice.items.filter(i => !i.productId && i.supplierProductCode)
    if (unlinkItems.length > 0) {
      // Collect all possible SKU codes to search in a single query
      const allCodes: string[] = []
      for (const item of unlinkItems) {
        const code = item.supplierProductCode!.trim()
        allCodes.push(code)
        if (code.startsWith('001') && code.length > 3) {
          allCodes.push(code.substring(3).trim())
        }
      }
      const matchedProducts = await prisma.product.findMany({
        where: { sku: { in: [...new Set(allCodes)] }, status: 'ACTIVE' },
        select: { id: true, sku: true },
      })
      const skuMap = new Map(matchedProducts.map(p => [p.sku, p.id]))

      // Batch update matched items
      const updates: Promise<any>[] = []
      for (const item of unlinkItems) {
        const code = item.supplierProductCode!.trim()
        const altCode = code.startsWith('001') && code.length > 3 ? code.substring(3).trim() : null
        const productId = skuMap.get(code) || (altCode ? skuMap.get(altCode) : null)
        if (productId) {
          updates.push(prisma.purchaseInvoiceItem.update({
            where: { id: item.id },
            data: { productId },
          }))
          autoLinkedCount++
        }
      }
      if (updates.length > 0) await Promise.all(updates)
    }

    if (autoLinkedCount > 0) {
      logger.info(`[FC Auto-link] ${autoLinkedCount}/${purchaseInvoice.items.length} items auto-vinculados`)
    }

    // Re-fetch with updated links
    const finalInvoice = autoLinkedCount > 0
      ? await prisma.purchaseInvoice.findUnique({
          where: { id: purchaseInvoice.id },
          include: {
            supplier: true,
            items: { include: { product: true } },
            taxes: true,
            perceptions: true,
          },
        })
      : purchaseInvoice

    return NextResponse.json(finalInvoice, { status: 201 });
  } catch (error) {
    logger.error('Error creating purchase invoice:', error);
    return NextResponse.json(
      { error: 'Error al crear factura de compra' },
      { status: 500 }
    );
  }
}

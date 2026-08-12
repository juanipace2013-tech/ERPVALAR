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

    if (status && status !== 'all') {
      where.status = status;
    }

    if (supplierId) {
      where.supplierId = supplierId;
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [purchaseOrders, totalCount] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: {
          supplier: {
            select: {
              id: true,
              name: true,
              taxId: true,
            },
          },
          // La tabla del listado solo muestra la CANTIDAD de items:
          // antes se bajaban todos los items con sus productos.
          _count: {
            select: { items: true },
          },
        },
        orderBy: {
          orderDate: 'desc',
        },
        take: pageSize,
        skip: page * pageSize,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    return NextResponse.json({ purchaseOrders, totalCount, page, pageSize });
  } catch (error) {
    logger.error('Error fetching purchase orders:', error);
    return NextResponse.json(
      { error: 'Error al cargar órdenes de compra' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const {
      supplierId,
      orderDate,
      expectedDate,
      currency,
      items,
      notes,
      status = 'DRAFT',
    } = body;

    // Validations
    if (!supplierId) {
      return NextResponse.json(
        { error: 'Proveedor es requerido' },
        { status: 400 }
      );
    }

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'Debe agregar al menos un item' },
        { status: 400 }
      );
    }

    // Calculate totals
    let subtotal = 0;
    let taxAmount = 0;

    items.forEach((item: any) => {
      const itemSubtotal = Number(item.quantity) * Number(item.unitCost);
      const itemDiscount = itemSubtotal * (Number(item.discount) / 100);
      const itemNet = itemSubtotal - itemDiscount;
      const itemTax = itemNet * (Number(item.taxRate) / 100);

      subtotal += itemSubtotal;
      taxAmount += itemTax;
    });

    const total = subtotal + taxAmount;

    // Generate order number + create in a transaction to prevent race conditions
    const purchaseOrder = await prisma.$transaction(async (tx) => {
      const lastOrder = await tx.purchaseOrder.findFirst({
        orderBy: { orderNumber: 'desc' },
        select: { orderNumber: true },
      });

      let nextNumber = 1;
      if (lastOrder?.orderNumber) {
        const match = lastOrder.orderNumber.match(/OC-(\d+)/);
        if (match) {
          nextNumber = parseInt(match[1]) + 1;
        }
      }

      const orderNumber = `OC-${nextNumber.toString().padStart(6, '0')}`;

      return tx.purchaseOrder.create({
        data: {
          orderNumber,
          supplierId,
          userId: session.user.id,
          status,
          currency: currency || 'ARS',
          subtotal,
          taxAmount,
          discount: 0,
          total,
          orderDate: orderDate ? new Date(orderDate) : new Date(),
          expectedDate: expectedDate ? new Date(expectedDate) : null,
          notes,
          items: {
            create: items.map((item: any) => ({
              productId: item.productId,
              quantity: parseInt(item.quantity),
              unitCost: Number(item.unitCost),
              discount: Number(item.discount || 0),
              taxRate: Number(item.taxRate || 21),
              subtotal: Number(item.quantity) * Number(item.unitCost),
              description: item.description,
            })),
          },
        },
        include: {
          supplier: true,
          items: {
            include: {
              product: true,
            },
          },
          user: true,
        },
      });
    }, { maxWait: 10000, timeout: 30000 });

    return NextResponse.json(purchaseOrder, { status: 201 });
  } catch (error) {
    logger.error('Error creating purchase order:', error);
    return NextResponse.json(
      { error: 'Error al crear orden de compra' },
      { status: 500 }
    );
  }
}

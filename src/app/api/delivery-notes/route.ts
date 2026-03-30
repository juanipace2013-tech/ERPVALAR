import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateDeliveryNumber } from '@/lib/quote-workflow';
import { logAudit } from '@/lib/audit';

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
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const page = parseInt(searchParams.get('page') || '0');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');

    const [deliveryNotes, totalCount] = await Promise.all([
      prisma.deliveryNote.findMany({
        where,
        select: {
          id: true,
          deliveryNumber: true,
          date: true,
          status: true,
          deliveryAddress: true,
          deliveryCity: true,
          deliveryProvince: true,
          bultos: true,
          carrier: true,
          customer: {
            select: {
              id: true,
              name: true,
              cuit: true,
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
              taxId: true,
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
        take: pageSize,
        skip: page * pageSize,
      }),
      prisma.deliveryNote.count({ where }),
    ]);

    return NextResponse.json({ deliveryNotes, totalCount, page, pageSize });
  } catch (error) {
    console.error('Error fetching delivery notes:', error);
    return NextResponse.json(
      { error: 'Error al cargar remitos' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/delivery-notes — Crear remito directo (sin cotización)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await request.json();

    const {
      date,
      carrier,
      transportAddress,
      purchaseOrder,
      customerInvoiceNumber,
      invoiceRef,
      bultos,
      totalAmountARS,
      notes,
      items,
      colppyCustomer,
      quoteId,
    } = body;

    let { customerId } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Debe agregar al menos un item' },
        { status: 400 }
      );
    }

    // Si viene colppyCustomer, upsert en la base local (igual que en quotes)
    if (colppyCustomer && colppyCustomer.cuit) {
      const existing = await prisma.customer.findFirst({
        where: { cuit: colppyCustomer.cuit },
      });

      if (existing) {
        await prisma.customer.update({
          where: { id: existing.id },
          data: {
            name: colppyCustomer.name,
            businessName: colppyCustomer.businessName,
            taxCondition: colppyCustomer.taxCondition,
            email: colppyCustomer.email || existing.email,
            phone: colppyCustomer.phone || existing.phone,
            mobile: colppyCustomer.mobile || existing.mobile,
            address: colppyCustomer.address || existing.address,
            city: colppyCustomer.city || existing.city,
            province: colppyCustomer.province || existing.province,
            postalCode: colppyCustomer.postalCode || existing.postalCode,
          },
        });
        customerId = existing.id;
      } else {
        const newCust = await prisma.customer.create({
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
            status: 'ACTIVE',
            type: 'BUSINESS',
          },
        });
        customerId = newCust.id;
      }
    }

    if (!customerId) {
      return NextResponse.json(
        { error: 'El cliente es requerido' },
        { status: 400 }
      );
    }

    // Verificar que el cliente existe
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      return NextResponse.json(
        { error: 'Cliente no encontrado' },
        { status: 404 }
      );
    }

    // Generar número de remito (usa CAI si hay activo, sino PV 0002)
    const { deliveryNumber, caiNumber } = await generateDeliveryNumber();

    // Crear remito con items
    const deliveryNote = await prisma.deliveryNote.create({
      data: {
        deliveryNumber,
        ...(caiNumber ? { caiNumber } : {}),
        customerId,
        quoteId: quoteId || null,
        date: date ? new Date(date) : new Date(),
        carrier: carrier || null,
        transportAddress: transportAddress || null,
        purchaseOrder: purchaseOrder || null,
        customerInvoiceNumber: customerInvoiceNumber || null,
        bultos: bultos || null,
        totalAmountARS: totalAmountARS ? parseFloat(totalAmountARS) : null,
        notes: notes
          ? (invoiceRef ? `Factura: ${invoiceRef}\n${notes}` : notes)
          : (invoiceRef ? `Factura: ${invoiceRef}` : null),
        deliveryAddress: body.deliveryAddress || customer.address || null,
        deliveryCity: body.deliveryCity || customer.city || null,
        deliveryProvince: body.deliveryProvince || customer.province || null,
        deliveryPostalCode: body.deliveryPostalCode || customer.postalCode || null,
        deliveryContactName: body.deliveryContactName || null,
        deliveryContactPhone: body.deliveryContactPhone || null,
        status: 'PENDING',
        items: {
          create: items.map((item: any) => ({
            productId: item.productId || null,
            sku: item.sku || null,
            description: item.description || 'Item',
            quantity: parseFloat(item.quantity) || 1,
            unit: item.unit || 'UN',
          })),
        },
      },
      include: {
        items: {
          include: { product: true },
        },
        customer: true,
      },
    });

    // Registrar auditoría
    logAudit({
      userId: session.user.id,
      userName: session.user.name || '',
      userEmail: session.user.email || '',
      action: 'CREATE',
      entity: 'DELIVERY_NOTE',
      entityId: deliveryNote.id,
      entityRef: deliveryNote.deliveryNumber,
      description: `Creó remito ${deliveryNote.deliveryNumber} para ${deliveryNote.customer?.name || 'N/A'}`,
    });

    return NextResponse.json(deliveryNote, { status: 201 });
  } catch (error) {
    console.error('Error creating delivery note:', error);
    return NextResponse.json(
      { error: 'Error al crear remito' },
      { status: 500 }
    );
  }
}

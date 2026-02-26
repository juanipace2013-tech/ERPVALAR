import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateDeliveryNumber } from '@/lib/quote-workflow';

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
      invoiceRef,
      bultos,
      totalAmountARS,
      notes,
      items,
      colppyCustomer,
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

    // Generar número de remito
    const deliveryNumber = await generateDeliveryNumber();

    // Crear remito con items
    const deliveryNote = await prisma.deliveryNote.create({
      data: {
        deliveryNumber,
        customerId,
        date: date ? new Date(date) : new Date(),
        carrier: carrier || null,
        transportAddress: transportAddress || null,
        purchaseOrder: purchaseOrder || null,
        bultos: bultos ? parseInt(bultos) : null,
        totalAmountARS: totalAmountARS ? parseFloat(totalAmountARS) : null,
        notes: notes
          ? (invoiceRef ? `Factura: ${invoiceRef}\n${notes}` : notes)
          : (invoiceRef ? `Factura: ${invoiceRef}` : null),
        deliveryAddress: customer.address || null,
        deliveryCity: customer.city || null,
        deliveryProvince: customer.province || null,
        deliveryPostalCode: customer.postalCode || null,
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

    return NextResponse.json(deliveryNote, { status: 201 });
  } catch (error) {
    console.error('Error creating delivery note:', error);
    return NextResponse.json(
      { error: 'Error al crear remito' },
      { status: 500 }
    );
  }
}

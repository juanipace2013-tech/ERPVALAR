import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateDeliveryNumber } from '@/lib/quote-workflow';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger'

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

    // Body opcional: { recipientId?, recipientType? }
    let body: { recipientId?: string; recipientType?: 'CUSTOMER' | 'SUPPLIER' } = {};
    try {
      body = await request.json();
    } catch {
      // Body vacío = duplicar con mismo destinatario
    }

    // Obtener remito original con todos sus items
    const original = await prisma.deliveryNote.findUnique({
      where: { id },
      include: {
        items: true,
        customer: true,
        supplier: true,
      },
    });

    if (!original) {
      return NextResponse.json(
        { error: 'Remito no encontrado' },
        { status: 404 }
      );
    }

    // Determinar destinatario del nuevo remito
    let targetCustomerId = original.customerId;
    let targetSupplierId = original.supplierId;
    let recipientName = original.customer?.name || original.supplier?.name || '';

    if (body.recipientId && body.recipientType) {
      if (body.recipientType === 'CUSTOMER') {
        const customer = await prisma.customer.findUnique({
          where: { id: body.recipientId },
        });
        if (!customer) {
          return NextResponse.json(
            { error: 'Cliente no encontrado' },
            { status: 404 }
          );
        }
        targetCustomerId = customer.id;
        targetSupplierId = null;
        recipientName = customer.name;
      } else if (body.recipientType === 'SUPPLIER') {
        const supplier = await prisma.supplier.findUnique({
          where: { id: body.recipientId },
        });
        if (!supplier) {
          return NextResponse.json(
            { error: 'Proveedor no encontrado' },
            { status: 404 }
          );
        }
        targetSupplierId = supplier.id;
        targetCustomerId = null;
        recipientName = supplier.name;
      }
    }

    // Generar nuevo número de remito
    const { deliveryNumber, caiNumber } = await generateDeliveryNumber();

    // Crear remito duplicado
    const newDeliveryNote = await prisma.deliveryNote.create({
      data: {
        deliveryNumber,
        ...(caiNumber ? { caiNumber } : {}),
        customerId: targetCustomerId,
        supplierId: targetSupplierId,
        date: new Date(),
        status: 'PENDING',
        // Copiar datos de transporte y observaciones
        carrier: original.carrier,
        transportAddress: original.transportAddress,
        purchaseOrder: original.purchaseOrder,
        bultos: original.bultos,
        notes: original.notes,
        internalNotes: original.internalNotes,
        // Copiar dirección de entrega (si cambió destinatario, se puede editar luego)
        deliveryAddress: original.deliveryAddress,
        deliveryCity: original.deliveryCity,
        deliveryProvince: original.deliveryProvince,
        deliveryPostalCode: original.deliveryPostalCode,
        // Copiar items
        items: {
          create: original.items.map((item) => ({
            productId: item.productId,
            sku: item.sku,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            warehouseLocation: item.warehouseLocation,
            batchNumber: item.batchNumber,
            serialNumber: item.serialNumber,
          })),
        },
      },
      include: {
        items: true,
        customer: true,
        supplier: true,
      },
    });

    // Registrar auditoría
    logAudit({
      userId: session.user.id,
      userName: session.user.name || '',
      userEmail: session.user.email || '',
      action: 'CREATE',
      entity: 'DELIVERY_NOTE',
      entityId: newDeliveryNote.id,
      entityRef: newDeliveryNote.deliveryNumber,
      description: `Duplicó remito ${original.deliveryNumber} → ${newDeliveryNote.deliveryNumber} para ${recipientName}`,
    });

    return NextResponse.json(newDeliveryNote, { status: 201 });
  } catch (error) {
    logger.error('Error duplicating delivery note:', error);
    return NextResponse.json(
      { error: 'Error al duplicar remito' },
      { status: 500 }
    );
  }
}

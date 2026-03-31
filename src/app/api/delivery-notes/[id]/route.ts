import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;

    const deliveryNote = await prisma.deliveryNote.findUnique({
      where: { id },
      include: {
        customer: true,
        supplier: true,
        quote: {
          include: {
            items: {
              include: {
                product: true
              }
            }
          }
        },
        items: {
          include: {
            product: true
          }
        },
        invoices: true
      }
    });

    if (!deliveryNote) {
      return NextResponse.json(
        { error: 'Remito no encontrado' },
        { status: 404 }
      );
    }

    return NextResponse.json(deliveryNote);
  } catch (error) {
    logger.error('Error fetching delivery note:', error);
    return NextResponse.json(
      { error: 'Error al cargar remito' },
      { status: 500 }
    );
  }
}

// ============================================================================
// PUT — Editar remito (solo DRAFT/PENDING)
// ============================================================================

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()

    const existing = await prisma.deliveryNote.findUnique({
      where: { id },
      select: { status: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Remito no encontrado' }, { status: 404 })
    }

    if (existing.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'Solo se pueden editar remitos en estado Pendiente' },
        { status: 400 }
      )
    }

    // Actualizar datos del remito
    const updated = await prisma.$transaction(async (tx) => {
      // Si vienen items nuevos, reemplazar los existentes
      if (body.items && Array.isArray(body.items)) {
        // Borrar items existentes
        await tx.deliveryNoteItem.deleteMany({
          where: { deliveryNoteId: id },
        })

        // Crear items nuevos
        await tx.deliveryNoteItem.createMany({
          data: body.items.map((item: any) => ({
            deliveryNoteId: id,
            productId: item.productId || null,
            sku: item.sku || null,
            description: item.description || '',
            quantity: item.quantity || 0,
            unit: item.unit || 'UN',
            warehouseLocation: item.warehouseLocation || null,
            batchNumber: item.batchNumber || null,
            serialNumber: item.serialNumber || null,
          })),
        })
      }

      // Actualizar campos del remito (sin cambiar cliente ni número)
      return tx.deliveryNote.update({
        where: { id },
        data: {
          date: body.date ? new Date(body.date) : undefined,
          carrier: body.carrier ?? undefined,
          transportAddress: body.transportAddress ?? undefined,
          purchaseOrder: body.purchaseOrder ?? undefined,
          customerInvoiceNumber: body.customerInvoiceNumber ?? undefined,
          bultos: body.bultos !== undefined ? (body.bultos || null) : undefined,
          totalAmountARS: body.totalAmountARS !== undefined
            ? (body.totalAmountARS ? Number(body.totalAmountARS) : null)
            : undefined,
          notes: body.notes ?? undefined,
          internalNotes: body.internalNotes ?? undefined,
          deliveryAddress: body.deliveryAddress ?? undefined,
          deliveryCity: body.deliveryCity ?? undefined,
          deliveryProvince: body.deliveryProvince ?? undefined,
        },
        include: {
          customer: true,
          items: { include: { product: true } },
          invoices: true,
        },
      })
    })

    return NextResponse.json(updated)
  } catch (error) {
    logger.error('Error updating delivery note:', error)
    return NextResponse.json(
      { error: 'Error al actualizar remito' },
      { status: 500 }
    )
  }
}

// ============================================================================
// DELETE — Eliminar remito (solo DRAFT/PENDING/ISSUED sin facturas)
// ============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params

    const existing = await prisma.deliveryNote.findUnique({
      where: { id },
      include: {
        invoices: { select: { id: true } },
        deliveryStops: { select: { id: true } },
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Remito no encontrado' }, { status: 404 })
    }

    // Solo permitir eliminar en estados tempranos
    const allowedStatuses = ['PENDING', 'PREPARING', 'READY']
    if (!allowedStatuses.includes(existing.status)) {
      return NextResponse.json(
        { error: `No se puede eliminar un remito en estado "${existing.status}". Solo se pueden eliminar remitos Pendientes, En Proceso o Listos.` },
        { status: 400 }
      )
    }

    // No eliminar si tiene facturas
    if (existing.invoices.length > 0) {
      return NextResponse.json(
        { error: 'No se puede eliminar un remito que tiene facturas asociadas.' },
        { status: 400 }
      )
    }

    // Desasociar delivery stops (no eliminarlas, solo desasociarlas)
    if (existing.deliveryStops.length > 0) {
      await prisma.deliveryStop.updateMany({
        where: { deliveryNoteId: id },
        data: { deliveryNoteId: null },
      })
    }

    // Eliminar (items se borran por cascade)
    await prisma.deliveryNote.delete({
      where: { id },
    })

    return NextResponse.json({ success: true, message: 'Remito eliminado correctamente' })
  } catch (error) {
    logger.error('Error deleting delivery note:', error)
    return NextResponse.json(
      { error: 'Error al eliminar remito' },
      { status: 500 }
    )
  }
}

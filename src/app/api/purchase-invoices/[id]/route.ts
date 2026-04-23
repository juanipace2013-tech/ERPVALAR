import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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

    const purchaseInvoice = await prisma.purchaseInvoice.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: {
          include: {
            product: true,
            account: true,
          },
        },
        taxes: true,
        perceptions: {
          include: {
            account: true,
          },
        },
        payments: true,
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true,
              },
            },
          },
        },
      },
    });

    if (!purchaseInvoice) {
      return NextResponse.json(
        { error: 'Factura de compra no encontrada' },
        { status: 404 }
      );
    }

    return NextResponse.json(purchaseInvoice);
  } catch (error) {
    logger.error('Error fetching purchase invoice:', error);
    return NextResponse.json(
      { error: 'Error al cargar factura de compra' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    // Whitelist de campos editables. Para limpiar el flag de revisión, mandar
    // { requiresReview: false, reviewReason: null }. El cliente puede también
    // actualizar la jurisdicción de percepciones a través de ?updatePerceptions=1
    // en una iteración futura — por ahora la jurisdicción se corrige creando la
    // factura de nuevo o editando vía Prisma.
    const data: Record<string, unknown> = {}
    if (body.status !== undefined) data.status = body.status
    if (body.description !== undefined) data.description = body.description
    if (body.internalNotes !== undefined) data.internalNotes = body.internalNotes
    if (body.requiresReview !== undefined) data.requiresReview = Boolean(body.requiresReview)
    if (body.reviewReason !== undefined) data.reviewReason = body.reviewReason || null

    const purchaseInvoice = await prisma.purchaseInvoice.update({
      where: { id },
      data,
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

    return NextResponse.json(purchaseInvoice);
  } catch (error) {
    logger.error('Error updating purchase invoice:', error);
    return NextResponse.json(
      { error: 'Error al actualizar factura de compra' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;

    const invoice = await prisma.purchaseInvoice.findUnique({
      where: { id },
      include: { payments: { select: { id: true } } },
    });

    if (!invoice) {
      return NextResponse.json(
        { error: 'Factura no encontrada' },
        { status: 404 }
      );
    }

    // Advertencia en log si fue sincronizada con Colppy (se elimina solo del ERP)
    if (invoice.colppyInvoiceId) {
      logger.info(`[DELETE] Factura ${invoice.invoiceNumber} sincronizada con Colppy (ID: ${invoice.colppyInvoiceId}). Se elimina solo del ERP.`)
    }

    // No permitir eliminar si tiene pagos asociados
    if (invoice.payments.length > 0) {
      return NextResponse.json(
        { error: 'No se puede eliminar una factura que tiene pagos registrados' },
        { status: 400 }
      );
    }

    // Items, taxes y perceptions se eliminan en cascada (onDelete: Cascade)
    await prisma.purchaseInvoice.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Error deleting purchase invoice:', error);
    return NextResponse.json(
      { error: 'Error al eliminar factura de compra' },
      { status: 500 }
    );
  }
}

import { auth } from '@/auth'
/**
 * API Endpoint: /api/facturas/[id]
 * Get invoice details with related inventory and accounting data
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server';
;
;
import { prisma } from '@/lib/prisma';

/**
 * GET /api/facturas/[id]
 * Get invoice details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { id } = await params;

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            businessName: true,
            cuit: true,
            taxCondition: true,
            address: true,
            city: true,
            province: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                stockQuantity: true,
              },
            },
          },
        },
        stockMovements: {
          include: {
            product: {
              select: {
                name: true,
                sku: true,
              },
            },
          },
        },
        journalEntries: {
          include: {
            lines: {
              include: {
                account: {
                  select: {
                    code: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!invoice) {
      return NextResponse.json(
        { error: 'Factura no encontrada' },
        { status: 404 }
      );
    }

    // Calculate totals for display
    const totalCMV = invoice.stockMovements.reduce(
      (sum, m) => sum + Number(m.totalCost),
      0
    );

    return NextResponse.json({
      ...invoice,
      subtotal: Number(invoice.subtotal),
      taxAmount: Number(invoice.taxAmount),
      discount: Number(invoice.discount),
      total: Number(invoice.total),
      totalCMV,
      stockMovements: invoice.stockMovements.map((m) => ({
        ...m,
        unitCost: Number(m.unitCost),
        totalCost: Number(m.totalCost),
      })),
      items: invoice.items.map((item) => ({
        ...item,
        unitPrice: Number(item.unitPrice),
        discount: Number(item.discount),
        taxRate: Number(item.taxRate),
        subtotal: Number(item.subtotal),
      })),
    });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    return NextResponse.json(
      { error: 'Error al obtener factura' },
      { status: 500 }
    );
  }
}

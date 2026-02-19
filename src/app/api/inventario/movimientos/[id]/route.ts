import { auth } from '@/auth'
/**
 * API Endpoint: /api/inventario/movimientos/[id]
 * Get details of a specific stock movement
 */

import { NextRequest, NextResponse } from 'next/server';
;
;
import { prisma } from '@/lib/prisma';

/**
 * GET /api/inventario/movimientos/[id]
 * Get stock movement details
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

    const movement = await prisma.stockMovement.findUnique({
      where: { id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            stockQuantity: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            invoiceType: true,
            total: true,
          },
        },
        journalEntry: {
          select: {
            id: true,
            entryNumber: true,
            description: true,
            status: true,
          },
        },
      },
    });

    if (!movement) {
      return NextResponse.json(
        { error: 'Movimiento no encontrado' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ...movement,
      unitCost: Number(movement.unitCost),
      totalCost: Number(movement.totalCost),
    });
  } catch (error) {
    console.error('Error fetching stock movement:', error);
    return NextResponse.json(
      { error: 'Error al obtener el movimiento' },
      { status: 500 }
    );
  }
}

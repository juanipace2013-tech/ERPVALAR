import { auth } from '@/auth'
/**
 * API Endpoint: /api/inventario/productos/[id]/ajuste
 * Adjust product stock to a specific quantity
 */

import { NextRequest, NextResponse } from 'next/server';
;
;
import { z } from 'zod';
import { processStockAdjustment } from '@/lib/inventario/stock.service';
import { stockAdjustmentSchema } from '@/lib/inventario/validations';

/**
 * POST /api/inventario/productos/[id]/ajuste
 * Adjust stock to a specific quantity
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    // Add productId and userId from params and session
    const adjustmentData = {
      ...body,
      productId: id,
      userId: session.user.id,
    };

    // Validate data
    const validatedData = stockAdjustmentSchema.parse(adjustmentData);

    // Process adjustment
    const movement = await processStockAdjustment(validatedData);

    return NextResponse.json(
      {
        success: true,
        message: 'Ajuste de stock realizado correctamente',
        movement,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: (error as any).errors },
        { status: 400 }
      );
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error('Error adjusting stock:', error);
    return NextResponse.json(
      { error: 'Error al ajustar el stock' },
      { status: 500 }
    );
  }
}

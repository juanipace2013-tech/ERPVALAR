import { auth } from '@/auth'
/**
 * API Endpoint: /api/inventario/productos/[id]/stock
 * Get stock history for a specific product
 */

import { NextRequest, NextResponse } from 'next/server';
;
;
import { z } from 'zod';
import { getProductStockHistory } from '@/lib/inventario/stock.service';
import { productStockQuerySchema } from '@/lib/inventario/validations';

/**
 * GET /api/inventario/productos/[id]/stock
 * Get product stock history
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
    const { searchParams } = new URL(request.url);

    // Parse and validate query parameters
    const queryData = productStockQuerySchema.parse({
      productId: id,
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
      limit: searchParams.get('limit') || '100',
      offset: searchParams.get('offset') || '0',
    });

    const history = await getProductStockHistory(id, {
      startDate: queryData.startDate,
      endDate: queryData.endDate,
      limit: queryData.limit,
      offset: queryData.offset,
    });

    return NextResponse.json(history);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Parámetros inválidos', details: (error as any).errors },
        { status: 400 }
      );
    }

    if (error instanceof Error && error.message.includes('no encontrado')) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error('Error fetching product stock history:', error);
    return NextResponse.json(
      { error: 'Error al obtener historial de stock' },
      { status: 500 }
    );
  }
}

/**
 * API Endpoint: /api/inventario/movimientos
 * Handles CRUD operations for stock movements
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server';
;
;
import { z } from 'zod';
import {
  getStockMovements,
  createManualStockMovement,
} from '@/lib/inventario/stock.service';
import {
  stockMovementSchema,
  stockMovementQuerySchema,
} from '@/lib/inventario/validations';

/**
 * GET /api/inventario/movimientos
 * List stock movements with filters
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    // Parse and validate query parameters
    const queryData = stockMovementQuerySchema.parse({
      productId: searchParams.get('productId') || undefined,
      type: searchParams.get('type') || undefined,
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
      limit: searchParams.get('limit') || '100',
      offset: searchParams.get('offset') || '0',
    });

    const movements = await getStockMovements(queryData);

    return NextResponse.json({
      movements,
      count: movements.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Parámetros inválidos', details: error.issues },
        { status: 400 }
      );
    }

    console.error('Error fetching stock movements:', error);
    return NextResponse.json(
      { error: 'Error al obtener movimientos de stock' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/inventario/movimientos
 * Create a manual stock movement (purchase, adjustment, return)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const body = await request.json();

    // Add userId from session
    const movementData = {
      ...body,
      userId: session.user.id,
    };

    // Validate data
    const validatedData = stockMovementSchema.parse(movementData);

    // Only allow certain types for manual creation
    const allowedTypes = [
      'COMPRA',
      'AJUSTE_POSITIVO',
      'AJUSTE_NEGATIVO',
      'DEVOLUCION_CLIENTE',
      'DEVOLUCION_PROVEEDOR',
    ];

    if (!allowedTypes.includes(validatedData.type)) {
      return NextResponse.json(
        {
          error: `Tipo de movimiento no permitido para creación manual: ${validatedData.type}`,
        },
        { status: 400 }
      );
    }

    // Create movement
    const movement = await createManualStockMovement(validatedData);

    return NextResponse.json(movement, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: error.issues },
        { status: 400 }
      );
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error('Error creating stock movement:', error);
    return NextResponse.json(
      { error: 'Error al crear movimiento de stock' },
      { status: 500 }
    );
  }
}

import { auth } from '@/auth'
/**
 * API Endpoint: /api/facturas/preview
 * Preview invoice impact on inventory before creation
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server';
;
;
import { z } from 'zod';
import { getInvoiceInventoryPreview } from '@/lib/inventario/invoice-inventory.service';

/**
 * Validation schema for preview request
 */
const invoiceItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
  discount: z.number().min(0).max(100).default(0),
  taxRate: z.number().min(0).max(100),
  subtotal: z.number().nonnegative(),
  description: z.string().optional(),
});

const previewSchema = z.object({
  items: z.array(invoiceItemSchema).min(1),
});

/**
 * POST /api/facturas/preview
 * Get preview of invoice impact on inventory
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const body = await request.json();

    // Validate data
    const validatedData = previewSchema.parse(body);

    // Get preview
    const preview = await getInvoiceInventoryPreview(validatedData.items);

    return NextResponse.json({
      success: true,
      preview: {
        valid: preview.stockValidation.valid,
        stockErrors: preview.stockValidation.errors,
        totalCMV: preview.cmvCalculation.totalCMV,
        currency: preview.cmvCalculation.currency,
        products: preview.productsInfo,
      },
    });
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

    console.error('Error generating invoice preview:', error);
    return NextResponse.json(
      { error: 'Error al generar preview' },
      { status: 500 }
    );
  }
}

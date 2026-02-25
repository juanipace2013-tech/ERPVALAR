import { auth } from '@/auth'
/**
 * API Endpoint: /api/facturas
 * Handles invoice creation with automatic inventory and accounting integration
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server';
;
;
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  processInvoiceCreationWithInventory,
  validateInvoiceForInventory,
} from '@/lib/inventario/invoice-inventory.service';

/**
 * Validation schema for invoice creation
 */
const invoiceItemSchema = z.object({
  productId: z.string().min(1, 'ID de producto requerido'),
  quantity: z.number().int().positive('La cantidad debe ser positiva'),
  unitPrice: z.number().positive('El precio unitario debe ser positivo'),
  discount: z.number().min(0).max(100).default(0),
  taxRate: z.number().min(0).max(100),
  subtotal: z.number().nonnegative(),
  description: z.string().optional(),
});

const invoiceCreateSchema = z.object({
  invoiceNumber: z.string().min(1, 'Número de factura requerido'),
  invoiceType: z.enum(['A', 'B', 'C', 'E'], {
    errorMap: () => ({ message: 'Tipo de factura inválido' }),
  }),
  customerId: z.string().min(1, 'ID de cliente requerido'),
  currency: z.enum(['ARS', 'USD', 'EUR']).default('ARS'),
  subtotal: z.number().nonnegative(),
  taxAmount: z.number().nonnegative(),
  discount: z.number().nonnegative().default(0),
  total: z.number().positive('El total debe ser positivo'),
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  quoteId: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(invoiceItemSchema).min(1, 'Debe incluir al menos un ítem'),
});

/**
 * GET /api/facturas
 * List invoices with filters and pagination
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status') || '';
    const customerId = searchParams.get('customerId') || '';

    const skip = (page - 1) * limit;

    // Build filters
    const where: Record<string, unknown> = {};

    if (status) {
      where.status = status;
    }

    if (customerId) {
      where.customerId = customerId;
    }

    // Get invoices with pagination
    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              cuit: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                },
              },
            },
          },
          _count: {
            select: {
              stockMovements: true,
              journalEntries: true,
            },
          },
        },
      }),
      prisma.invoice.count({ where }),
    ]);

    return NextResponse.json({
      invoices,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    return NextResponse.json(
      { error: 'Error al obtener facturas' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/facturas
 * Create invoice with automatic inventory and accounting integration
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const body = await request.json();

    // Add userId from session
    const invoiceData = {
      ...body,
      userId: session.user.id,
    };

    // Validate data
    const validatedData = invoiceCreateSchema.parse(invoiceData);

    // Validate invoice number is unique
    const existingInvoice = await prisma.invoice.findUnique({
      where: { invoiceNumber: validatedData.invoiceNumber },
    });

    if (existingInvoice) {
      return NextResponse.json(
        { error: 'Ya existe una factura con este número' },
        { status: 400 }
      );
    }

    // Validate invoice data (stock, costs, etc.)
    const validation = await validateInvoiceForInventory(validatedData);

    if (!validation.valid) {
      return NextResponse.json(
        {
          error: 'Validación de factura falló',
          details: validation.errors,
        },
        { status: 400 }
      );
    }

    // Process invoice creation with inventory and accounting
    const result = await processInvoiceCreationWithInventory(validatedData);

    return NextResponse.json(
      {
        success: true,
        message: 'Factura creada correctamente',
        invoice: result.invoice,
        stockMovements: result.movements.length,
        journalEntry: {
          id: result.journalEntry.id,
          entryNumber: result.journalEntry.entryNumber,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: error.issues },
        { status: 400 }
      );
    }

    if (error instanceof Error) {
      console.error('Error creating invoice:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    console.error('Error creating invoice:', error);
    return NextResponse.json(
      { error: 'Error al crear factura' },
      { status: 500 }
    );
  }
}

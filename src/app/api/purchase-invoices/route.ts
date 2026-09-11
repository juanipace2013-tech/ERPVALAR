import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger'
import {
  createPurchaseInvoice,
  buildInvoiceNumber,
  isDuplicateInvoiceError,
  type CreatePurchaseInvoiceInput,
} from '@/lib/purchase-invoices/create'

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const supplierId = searchParams.get('supplierId');
    const search = searchParams.get('search');

    const page = parseInt(searchParams.get('page') || '0');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');
    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (supplierId) {
      where.supplierId = supplierId;
    }

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [purchaseInvoices, totalCount] = await Promise.all([
      prisma.purchaseInvoice.findMany({
        where,
        // select con SOLO los campos de la tabla del listado: el modelo
        // PurchaseInvoice completo tiene ~45 columnas (con campos Text) y los
        // items no se usaban en la pantalla.
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          voucherType: true,
          total: true,
          balance: true,
          status: true,
          requiresReview: true,
          reviewReason: true,
          stockImpact: true,
          cae: true,
          colppyInvoiceId: true,
          supplier: {
            select: {
              id: true,
              name: true,
              taxId: true,
            },
          },
        },
        orderBy: {
          invoiceDate: 'desc',
        },
        take: pageSize,
        skip: page * pageSize,
      }),
      prisma.purchaseInvoice.count({ where }),
    ]);

    return NextResponse.json({ purchaseInvoices, totalCount, page, pageSize });
  } catch (error) {
    logger.error('Error fetching purchase invoices:', error);
    return NextResponse.json(
      { error: 'Error al cargar facturas de compra' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Declarado fuera del try para poder referenciarlo en el catch (ej. mensaje de
  // conflicto P2002 por invoiceNumber duplicado).
  let invoiceNumber = '';
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = (await request.json()) as CreatePurchaseInvoiceInput;
    invoiceNumber = buildInvoiceNumber(body.voucherType, body.pointOfSale, body.invoiceNumberSuffix);

    const { invoice, warnings, requiresReview, reviewReason } = await createPurchaseInvoice(
      body,
      session.user.id
    );

    // Si hay warnings (ej. jurisdicción IIBB no resuelta), los adjuntamos al
    // response body para que el frontend pueda mostrarlos. Mantenemos 201 porque
    // la factura SÍ se creó exitosamente — el caller decide si avisa al usuario.
    const responseBody = warnings.length > 0
      ? { ...invoice, warnings, requiresReview, reviewReason }
      : invoice
    return NextResponse.json(responseBody, { status: 201 });
  } catch (error) {
    // Conflicto por constraint único en invoiceNumber: el comprobante ya fue
    // cargado previamente (típicamente porque ya existe en Colppy). Devolvemos
    // 409 con un mensaje claro en vez del 500 genérico para que el operador
    // entienda que no es un error interno.
    if (isDuplicateInvoiceError(error)) {
      return NextResponse.json(
        {
          error: `Ya existe una factura de compra con el número ${invoiceNumber} para este proveedor`,
        },
        { status: 409 }
      )
    }

    logger.error('Error creating purchase invoice:', error);
    return NextResponse.json(
      { error: 'Error al crear factura de compra' },
      { status: 500 }
    );
  }
}

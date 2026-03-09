import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateRemitoExcel, type RemitoExcelData } from '@/lib/excel/remito-generator'

/**
 * GET /api/delivery-notes/[id]/excel
 *
 * Genera un archivo Excel (.xlsx) con los datos del remito posicionados
 * para imprimir sobre hojas de remito preimpresas.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params

    const deliveryNote = await prisma.deliveryNote.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            name: true,
            businessName: true,
            cuit: true,
            address: true,
            city: true,
            province: true,
          },
        },
        items: {
          include: {
            product: {
              select: {
                sku: true,
                name: true,
              },
            },
          },
        },
        invoices: {
          select: { invoiceNumber: true },
          take: 1,
        },
      },
    })

    if (!deliveryNote) {
      return NextResponse.json({ error: 'Remito no encontrado' }, { status: 404 })
    }

    // Armar datos para el generador Excel
    const excelData: RemitoExcelData = {
      deliveryNumber: deliveryNote.deliveryNumber,
      date: deliveryNote.date,
      customer: {
        businessName: deliveryNote.customer.businessName || deliveryNote.customer.name,
        address: deliveryNote.customer.address || '',
        city: [deliveryNote.customer.city, deliveryNote.customer.province]
          .filter(Boolean)
          .join(', '),
        cuit: deliveryNote.customer.cuit || '',
      },
      purchaseOrder: deliveryNote.purchaseOrder,
      customerInvoiceNumber:
        deliveryNote.customerInvoiceNumber ||
        (deliveryNote.invoices[0]?.invoiceNumber ?? null),
      items: deliveryNote.items.map((item) => ({
        sku: item.sku || item.product?.sku || '',
        description: item.description || item.product?.name || '',
        quantity: Number(item.quantity),
      })),
      bultos: deliveryNote.bultos,
      totalAmountARS: deliveryNote.totalAmountARS
        ? Number(deliveryNote.totalAmountARS)
        : null,
    }

    const buffer = await generateRemitoExcel(excelData)

    // Sanitizar nombre de archivo
    const safeCustomer = (
      deliveryNote.customer.businessName || deliveryNote.customer.name
    )
      .replace(/[/\\:*?"<>|]/g, '-')
      .trim()
    const safeNumber = deliveryNote.deliveryNumber.replace(/\s/g, '-')

    return new NextResponse(buffer, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Remito-${safeNumber} ${safeCustomer}.xlsx"`,
      },
    })
  } catch (error) {
    console.error('Error generando Excel remito:', error)
    return NextResponse.json(
      {
        error: 'Error al generar Excel',
        details: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 }
    )
  }
}

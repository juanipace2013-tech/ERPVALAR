import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { generatePurchaseOrderPDF } from '@/lib/pdf/purchase-order-generator'

// GET /api/purchase-orders/[id]/pdf — PDF de la OC para mandar al proveedor (?inline=true para verla)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params

    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: {
          select: {
            name: true,
            legalName: true,
            taxId: true,
            email: true,
            address: true,
            city: true,
            province: true,
            postalCode: true,
          },
        },
        user: { select: { name: true, email: true, phone: true } },
        items: {
          include: { product: { select: { sku: true, name: true } } },
          orderBy: { id: 'asc' },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Orden de compra no encontrada' }, { status: 404 })
    }

    const { supplier } = order
    const address = [
      supplier.address,
      [supplier.postalCode, supplier.city].filter(Boolean).join(' '),
      supplier.province,
    ]
      .filter(Boolean)
      .join(', ')

    const pdfBlob = await generatePurchaseOrderPDF({
      orderNumber: order.orderNumber,
      orderDate: order.orderDate,
      expectedDate: order.expectedDate,
      currency: order.currency,
      supplier: {
        name: supplier.name,
        legalName: supplier.legalName,
        taxId: supplier.taxId,
        address: address || null,
        email: supplier.email,
      },
      buyer: { name: order.user.name, email: order.user.email, phone: order.user.phone },
      items: order.items.map((item) => ({
        code: item.product?.sku || null,
        description: item.description || item.product?.name || '',
        quantity: item.quantity,
        unitCost: Number(item.unitCost),
        discount: Number(item.discount),
        taxRate: Number(item.taxRate),
      })),
      notes: order.notes,
    })
    const buffer = Buffer.from(await pdfBlob.arrayBuffer())

    const inline = request.nextUrl.searchParams.get('inline') === 'true'
    const safeName = (supplier.legalName || supplier.name).replace(/[/\\:*?"<>|]/g, '-').trim()

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${order.orderNumber} ${safeName}.pdf"`,
      },
    })
  } catch (error) {
    logger.error('Error generando PDF de orden de compra:', error)
    return NextResponse.json({ error: 'Error al generar PDF' }, { status: 500 })
  }
}

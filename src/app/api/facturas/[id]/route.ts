/**
 * GET /api/facturas/[id] — detalle de un comprobante de venta (Invoice) con
 * cliente, ítems, datos de emisión ARCA, estado en Colppy y NC/ND asociadas.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const { id } = await params

    const inv = await prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, businessName: true, cuit: true, email: true, phone: true, address: true, taxCondition: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        quote: { select: { id: true, quoteNumber: true, status: true } },
        relatedInvoice: { select: { id: true, invoiceNumber: true, invoiceType: true, total: true, cae: true } },
        relatedInvoices: {
          select: { id: true, invoiceNumber: true, transactionType: true, invoiceType: true, total: true, cae: true, issueDate: true, status: true, colppySyncStatus: true },
          orderBy: { issueDate: 'asc' },
        },
        user: { select: { id: true, name: true } },
      },
    })
    if (!inv) return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 })

    // No exponer el payload completo de Colppy (ruido); sí si está pendiente para diagnóstico
    const { colppyPayload, ...rest } = inv
    return NextResponse.json({
      ...rest,
      tieneColppyPayload: !!colppyPayload,
      pdfUrl: inv.emitidaPor === 'ARCA' && inv.cae ? `/api/facturas/${inv.id}/pdf` : null,
    })
  } catch (error) {
    logger.error('[Facturas] Error detalle:', error)
    return NextResponse.json({ error: 'Error al cargar factura' }, { status: 500 })
  }
}

/**
 * GET /api/facturas — listado de comprobantes de venta del ERP (Invoice).
 *   ?limit=50&offset=0&search=texto&emitidaPor=ARCA&customerId=...
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const sp = request.nextUrl.searchParams
    const limit = Math.min(Number(sp.get('limit') || 50), 200)
    const offset = Number(sp.get('offset') || 0)
    const search = (sp.get('search') || '').trim()
    const emitidaPor = sp.get('emitidaPor')
    const customerId = sp.get('customerId')

    const where: Prisma.InvoiceWhereInput = {
      ...(emitidaPor ? { emitidaPor } : {}),
      ...(customerId ? { customerId } : {}),
      ...(search
        ? {
            OR: [
              { invoiceNumber: { contains: search, mode: 'insensitive' } },
              { customer: { name: { contains: search, mode: 'insensitive' } } },
              { customer: { cuit: { contains: search } } },
              { cae: { contains: search } },
              // Orden de compra del cliente: la de la cotización o la del remito
              { quote: { purchaseOrderNumber: { contains: search, mode: 'insensitive' } } },
              { deliveryNote: { purchaseOrder: { contains: search, mode: 'insensitive' } } },
              { quote: { quoteNumber: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    }

    const [total, invoices] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, cuit: true } },
          quote: { select: { quoteNumber: true, purchaseOrderNumber: true } },
          deliveryNote: { select: { purchaseOrder: true } },
        },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        skip: offset,
      }),
    ])

    return NextResponse.json({ invoices, total, limit, offset })
  } catch (error) {
    logger.error('[Facturas] Error listando:', error)
    return NextResponse.json({ error: 'Error al listar facturas' }, { status: 500 })
  }
}

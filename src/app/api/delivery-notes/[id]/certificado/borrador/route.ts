import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { requireRole, ROLES } from '@/lib/authz'
import {
  aItemCertificado,
  asuntoPedido,
  CONTACTOS_PROVEEDOR,
  crearBorradorPedido,
  cuerpoPedido,
} from '@/lib/certificados-calidad/pedido'

/**
 * Arma en Outlook (buzón de administración) el borrador del pedido de
 * certificado al proveedor, con los ítems de una marca del remito.
 * Body: { marca: string, para?: string }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const forbidden = requireRole(session, ROLES.OPERATIVOS)
    if (forbidden) return forbidden

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const marca = String(body.marca || '').toUpperCase()
    const contacto = CONTACTOS_PROVEEDOR[marca]
    const para = String(body.para || contacto?.email || '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) {
      return NextResponse.json({ error: 'Falta el mail del proveedor' }, { status: 400 })
    }

    const dn = await prisma.deliveryNote.findUnique({
      where: { id },
      select: {
        purchaseOrder: true,
        customer: { select: { name: true, businessName: true } },
        quote: { select: { purchaseOrderNumber: true } },
        items: {
          select: { sku: true, quantity: true, batchNumber: true, product: { select: { sku: true, brand: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    if (!dn) return NextResponse.json({ error: 'Remito no encontrado' }, { status: 404 })
    if (!dn.customer) return NextResponse.json({ error: 'El remito no es a un cliente' }, { status: 400 })

    const items = dn.items.map(aItemCertificado).filter((i) => i.marca === marca)
    if (!items.length) return NextResponse.json({ error: `El remito no tiene ítems ${marca}` }, { status: 400 })
    const sinLote = items.filter((i) => !i.lote)
    if (sinLote.length) {
      return NextResponse.json({ error: `Falta el lote de: ${sinLote.map((i) => i.codigo).join(', ')}` }, { status: 400 })
    }

    const cliente = dn.customer.businessName?.trim() || dn.customer.name
    const ordenCompra = dn.purchaseOrder?.trim() || dn.quote?.purchaseOrderNumber?.trim() || null
    const asunto = asuntoPedido(cliente)
    const html = cuerpoPedido({ contacto: para === contacto?.email ? contacto.nombre : undefined, items, ordenCompra })
    const draft = await crearBorradorPedido({ para, asunto, html })

    await prisma.deliveryNote.update({
      where: { id },
      data: { certificadoPedidoAt: new Date(), certificadoPedidoA: para },
    })
    logger.info(`[CertificadoCalidad] Borrador ${asunto} -> ${para}`)
    return NextResponse.json({ ok: true, webLink: draft.webLink, asunto, para })
  } catch (error) {
    logger.error('Error armando el pedido de certificado:', error)
    return NextResponse.json({ error: (error as Error).message || 'Error al armar el borrador' }, { status: 500 })
  }
}

import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { requireRole, ROLES } from '@/lib/authz'
import { CONTACTOS_PROVEEDOR } from '@/lib/certificados-calidad/pedido'

/**
 * Remitos con "Solicita certificado de calidad": los que faltan pedir o
 * recibir, más los recibidos en los últimos 60 días.
 */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const forbidden = requireRole(session, ROLES.OPERATIVOS)
    if (forbidden) return forbidden

    const desde = new Date(Date.now() - 60 * 86400_000)
    const remitos = await prisma.deliveryNote.findMany({
      where: {
        solicitaCertificadoCalidad: true,
        status: { not: 'CANCELLED' },
        OR: [{ certificadoRecibidoAt: null }, { certificadoRecibidoAt: { gte: desde } }],
      },
      select: {
        id: true,
        deliveryNumber: true,
        date: true,
        status: true,
        purchaseOrder: true,
        certificadoPedidoAt: true,
        certificadoPedidoA: true,
        certificadoRecibidoAt: true,
        customer: { select: { id: true, name: true, businessName: true } },
        quote: { select: { id: true, quoteNumber: true, purchaseOrderNumber: true } },
        items: {
          select: {
            id: true,
            sku: true,
            description: true,
            quantity: true,
            batchNumber: true,
            product: { select: { sku: true, brand: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { date: 'desc' },
      take: 300,
    })
    return NextResponse.json({ remitos, contactos: CONTACTOS_PROVEEDOR })
  } catch (error) {
    logger.error('Error listando remitos con certificado:', error)
    return NextResponse.json({ error: 'Error al listar' }, { status: 500 })
  }
}

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { requireRole, ROLES } from '@/lib/authz'

/**
 * Carga de lotes y estado del certificado de calidad de un remito.
 * Body: { lotes?: { [itemId]: string }, pedido?: boolean, recibido?: boolean }
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const forbidden = requireRole(session, ROLES.OPERATIVOS)
    if (forbidden) return forbidden

    const { id } = await params
    const body = await request.json()
    const dn = await prisma.deliveryNote.findUnique({ where: { id }, select: { id: true, items: { select: { id: true } } } })
    if (!dn) return NextResponse.json({ error: 'Remito no encontrado' }, { status: 404 })

    const itemIds = new Set(dn.items.map((i) => i.id))
    const lotes: Record<string, unknown> = body.lotes && typeof body.lotes === 'object' ? body.lotes : {}
    const ops = Object.entries(lotes)
      .filter(([itemId]) => itemIds.has(itemId))
      .map(([itemId, lote]) =>
        prisma.deliveryNoteItem.update({
          where: { id: itemId },
          data: { batchNumber: typeof lote === 'string' && lote.trim() ? lote.trim() : null },
        })
      )

    const data: { certificadoPedidoAt?: Date | null; certificadoRecibidoAt?: Date | null } = {}
    if (typeof body.pedido === 'boolean') data.certificadoPedidoAt = body.pedido ? new Date() : null
    if (typeof body.recibido === 'boolean') data.certificadoRecibidoAt = body.recibido ? new Date() : null

    await prisma.$transaction([...ops, prisma.deliveryNote.update({ where: { id }, data })])
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error('Error guardando certificado del remito:', error)
    return NextResponse.json({ error: 'Error al guardar' }, { status: 500 })
  }
}

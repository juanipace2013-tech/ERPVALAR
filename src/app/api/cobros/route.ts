/**
 * Recibos de cobro a clientes (se registran en Colppy). Ver
 * src/lib/cobros-colppy/registrar.ts y docs/DISENO-COBROS-COLPPY.md.
 *
 * GET  → últimos cobros (?customerId=, ?limit=)
 * POST → registra un recibo en Colppy.
 *   Body: { idempotencyKey (UUID), customerId, fecha (YYYY-MM-DD),
 *           cobros: { [idFacturaColppy]: importe }, medios: [{ cuenta, importe }], descripcion? }
 *   201 { id, estado: REGISTRADA|ERROR|INCIERTO, numero, colppyCobroId, totalCobrado, error, repetida:false }
 *   200 lo mismo con repetida:true (esa clave ya se registró: no se manda de nuevo)
 * Roles: ADMIN, GERENTE, CONTADOR.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, ROLES } from '@/lib/authz'
import { logger } from '@/lib/logger'
import { logAudit } from '@/lib/audit'
import { CobroError, registrarCobro, validarPedidoCobro } from '@/lib/cobros-colppy/registrar'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const forbidden = requireRole(session, ROLES.FINANZAS)
  if (forbidden) return forbidden

  const sp = req.nextUrl.searchParams
  const limit = Math.min(200, Math.max(1, Number(sp.get('limit')) || 50))
  const customerId = sp.get('customerId') || undefined
  const cobros = await prisma.customerCollection.findMany({
    where: customerId ? { customerId } : {},
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      customer: { select: { id: true, name: true, businessName: true } },
      createdBy: { select: { name: true } },
      applications: { select: { invoiceNumber: true, amount: true } },
      media: { select: { accountName: true, amount: true } },
    },
  })
  return NextResponse.json({
    cobros: cobros.map((o) => ({
      id: o.id,
      fecha: o.collectionDate.toISOString().slice(0, 10),
      estado: o.status,
      numero: o.receiptNumber,
      colppyCobroId: o.colppyCobroId,
      cliente: { id: o.customer.id, nombre: o.customer.businessName || o.customer.name },
      totalCobrado: Number(o.totalCollected),
      comprobantes: o.applications.map((a) => ({ numero: a.invoiceNumber, importe: Number(a.amount) })),
      medios: o.media.map((m) => ({ cuenta: m.accountName, importe: Number(m.amount) })),
      error: o.lastError,
      creadoPor: o.createdBy.name,
      creadoEl: o.createdAt.toISOString(),
    })),
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const forbidden = requireRole(session, ROLES.FINANZAS, 'Sin permisos para registrar cobros')
  if (forbidden) return forbidden

  try {
    const pedido = validarPedidoCobro(await req.json().catch(() => null))
    const r = await registrarCobro(pedido, { id: session.user.id })
    if (!r.repetida) {
      logAudit({
        userId: session.user.id,
        userName: session.user.name || '',
        userEmail: session.user.email || '',
        action: 'CREATE',
        entity: 'CUSTOMER_COLLECTION',
        entityId: r.id,
        entityRef: r.numero ?? undefined,
        description: `Recibo ${r.numero ?? '(sin número)'} a cliente: ${r.estado}, total cobrado ${r.totalCobrado}${r.error ? ` — ${r.error}` : ''}`,
      })
    }
    return NextResponse.json(r, { status: r.repetida ? 200 : 201 })
  } catch (e) {
    if (e instanceof CobroError) return NextResponse.json({ error: e.message, codigo: e.codigo, ...e.extra }, { status: e.status })
    logger.error('[Cobros] Error registrando', { error: (e as Error).message, stack: (e as Error).stack })
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

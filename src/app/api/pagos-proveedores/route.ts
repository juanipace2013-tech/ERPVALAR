/**
 * Órdenes de pago a proveedores (se registran en Colppy). Ver
 * src/lib/pagos-proveedores/registrar.ts y docs/DISENO-PAGOS-PROVEEDORES-COLPPY.md.
 *
 * GET  → últimas órdenes (?supplierId=, ?limit=)
 * POST → registra una orden en Colppy.
 *   Body: { idempotencyKey (UUID), supplierId, fecha (YYYY-MM-DD),
 *           pagos: { [idFacturaColppy]: importe }, retencionManual?: number|null,
 *           sinRetencion?: boolean, medios: [{ cuenta, importe }], descripcion? }
 *   201 { id, estado: REGISTRADA|ERROR|INCIERTO, numero, colppyPaymentId, totalPagado, error, repetida:false }
 *   200 lo mismo con repetida:true (esa clave ya se registró: no se manda de nuevo)
 *   400 pedido mal formado · 404 proveedor · 409 EN_CURSO / CLAVE_USADA
 *   422 VALIDACION / SIN_COLPPY / REGIMEN_NO_SOPORTADO · 502 COLPPY_LECTURA · 503 APAGADO
 * Roles: ADMIN, GERENTE, CONTADOR.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, ROLES } from '@/lib/authz'
import { logger } from '@/lib/logger'
import { logAudit } from '@/lib/audit'
import { OrdenPagoError, registrarOrdenDePago, validarPedidoOrdenPago } from '@/lib/pagos-proveedores/registrar'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const forbidden = requireRole(session, ROLES.FINANZAS)
  if (forbidden) return forbidden

  const sp = req.nextUrl.searchParams
  const limit = Math.min(200, Math.max(1, Number(sp.get('limit')) || 50))
  const supplierId = sp.get('supplierId') || undefined
  const ordenes = await prisma.supplierPaymentOrder.findMany({
    where: supplierId ? { supplierId } : {},
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      supplier: { select: { id: true, name: true, legalName: true } },
      createdBy: { select: { name: true } },
      _count: { select: { applications: true } },
    },
  })
  return NextResponse.json({
    ordenes: ordenes.map((o) => ({
      id: o.id,
      fecha: o.paymentDate.toISOString().slice(0, 10),
      estado: o.status,
      numero: o.paymentNumber,
      colppyPaymentId: o.colppyPaymentId,
      proveedor: { id: o.supplier.id, nombre: o.supplier.legalName || o.supplier.name },
      totalFacturas: Number(o.invoicesTotal),
      retencion: Number(o.retentionAmount),
      totalPagado: Number(o.totalPaid),
      facturas: o._count.applications,
      error: o.lastError,
      creadaPor: o.createdBy.name,
      creadaEl: o.createdAt.toISOString(),
    })),
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const forbidden = requireRole(session, ROLES.FINANZAS, 'Sin permisos para registrar pagos a proveedores')
  if (forbidden) return forbidden

  try {
    const pedido = validarPedidoOrdenPago(await req.json().catch(() => null), { requiereClave: true })
    const r = await registrarOrdenDePago(pedido, { id: session.user.id })
    if (!r.repetida) {
      logAudit({
        userId: session.user.id,
        userName: session.user.name || '',
        userEmail: session.user.email || '',
        action: 'CREATE',
        entity: 'SUPPLIER_PAYMENT',
        entityId: r.id,
        entityRef: r.numero ?? undefined,
        description: `Orden de pago ${r.numero ?? '(sin número)'} a proveedor: ${r.estado}, total pagado ${r.totalPagado}${r.error ? ` — ${r.error}` : ''}`,
      })
    }
    return NextResponse.json(r, { status: r.repetida ? 200 : 201 })
  } catch (e) {
    if (e instanceof OrdenPagoError) return NextResponse.json({ error: e.message, codigo: e.codigo, ...e.extra }, { status: e.status })
    logger.error('[Pagos proveedores] Error registrando', { error: (e as Error).message, stack: (e as Error).stack })
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

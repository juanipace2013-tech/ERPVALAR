/**
 * POST /api/facturas/[id]/reenviar-colppy — reintenta el alta en Colppy de una
 * factura emitida por el ERP (ARCA) cuyo registro en Colppy falló
 * (colppySyncStatus PENDIENTE/ERROR). Idempotente.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { reintentarAltaColppy } from '@/lib/facturacion/emision-arca'
import { logAudit } from '@/lib/audit'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const role = (session.user as { role?: string }).role
  if (role && !['ADMIN', 'GERENTE', 'CONTADOR'].includes(role)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { id } = await params
  const r = await reintentarAltaColppy(id)
  if (r.ok) {
    logAudit({
      userId: session.user.id,
      userName: session.user.name || '',
      userEmail: session.user.email || '',
      action: 'UPDATE',
      entity: 'INVOICE',
      entityId: id,
      description: `Reintento de alta en Colppy OK (colppyId ${r.colppyId})`,
    })
    return NextResponse.json({ success: true, colppyId: r.colppyId })
  }
  return NextResponse.json({ success: false, error: r.error }, { status: 502 })
}

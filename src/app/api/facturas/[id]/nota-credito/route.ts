/**
 * POST /api/facturas/[id]/nota-credito — emite una nota de crédito (ARCA) sobre
 * una factura emitida por el ERP y la registra en Colppy.
 *   body: { motivo?: string, netoParcial?: number }  (sin netoParcial = NC total)
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { emitirNotaCredito, NotaCreditoError } from '@/lib/facturacion/nota-credito-arca'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const role = (session.user as { role?: string }).role
  if (role && !['ADMIN', 'GERENTE', 'CONTADOR'].includes(role)) {
    return NextResponse.json({ error: 'Sin permisos para emitir notas de crédito' }, { status: 403 })
  }
  const { id } = await params
  let body: { motivo?: string; netoParcial?: number } = {}
  try {
    body = await request.json()
  } catch {
    /* sin body */
  }

  try {
    const r = await emitirNotaCredito(id, {
      userId: session.user.id,
      motivo: body.motivo,
      netoParcial: body.netoParcial ? Number(body.netoParcial) : undefined,
    })
    logAudit({
      userId: session.user.id,
      userName: session.user.name || '',
      userEmail: session.user.email || '',
      action: 'CREATE',
      entity: 'INVOICE',
      entityId: r.invoiceId,
      entityRef: r.numero,
      description: `Nota de crédito ${r.esTotal ? 'total' : 'parcial'} ${r.numero} (CAE ${r.cae}) sobre factura ${id}${body.motivo ? ` — ${body.motivo}` : ''}${r.colppyPendiente ? ' [PENDIENTE Colppy]' : ''}`,
    })
    return NextResponse.json({
      ...r,
      pdfUrl: `/api/facturas/${r.invoiceId}/pdf`,
      message: `Nota de crédito ${r.numero} emitida (CAE ${r.cae})${r.colppyPendiente ? '. ATENCIÓN: no se pudo registrar en Colppy, reintentar.' : ' y registrada en Colppy'}`,
    })
  } catch (e) {
    if (e instanceof NotaCreditoError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    logger.error('[NC] Error emitiendo nota de crédito:', e)
    return NextResponse.json({ error: (e as Error).message || 'Error al emitir la nota de crédito' }, { status: 500 })
  }
}

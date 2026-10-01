/**
 * GET  /api/facturas/[id]/nota-credito — líneas de la factura con lo disponible
 *      para devolver (NC por unidades).
 * POST /api/facturas/[id]/nota-credito — emite una nota de crédito (ARCA) sobre
 * una factura emitida por el ERP y la registra en Colppy.
 *   body: { motivo?, netoParcial? }            (sin netoParcial = NC total)
 *      o  { motivo?, unidades: [{ index, cantidad }] }  (devolución por unidades)
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { emitirNotaCredito, NotaCreditoError, obtenerLineasNcUnidades } from '@/lib/facturacion/nota-credito-arca'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { id } = await params
  const r = await obtenerLineasNcUnidades(id)
  if (!r) return NextResponse.json({ error: 'La factura no tiene el detalle de líneas para devolver por unidades' }, { status: 404 })
  return NextResponse.json(r)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const role = (session.user as { role?: string }).role
  if (role && !['ADMIN', 'GERENTE', 'CONTADOR'].includes(role)) {
    return NextResponse.json({ error: 'Sin permisos para emitir notas de crédito' }, { status: 403 })
  }
  const { id } = await params
  let body: { motivo?: string; netoParcial?: number; unidades?: Array<{ index: number; cantidad: number }> } = {}
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
      unidades: Array.isArray(body.unidades)
        ? body.unidades.map((u) => ({ index: Number(u.index), cantidad: Number(u.cantidad) }))
        : undefined,
    })
    logAudit({
      userId: session.user.id,
      userName: session.user.name || '',
      userEmail: session.user.email || '',
      action: 'CREATE',
      entity: 'INVOICE',
      entityId: r.invoiceId,
      entityRef: r.numero,
      description: `Nota de crédito ${r.esTotal ? 'total' : r.modo === 'UNIDADES' ? 'por unidades (devolución)' : 'parcial'} ${r.numero} (CAE ${r.cae}) sobre factura ${id}${body.motivo ? ` — ${body.motivo}` : ''}${r.colppyPendiente ? ' [PENDIENTE Colppy]' : r.colppyBorradorFce ? ' [BORRADOR FCE en Colppy]' : ''}`,
    })
    return NextResponse.json({
      ...r,
      pdfUrl: `/api/facturas/${r.invoiceId}/pdf`,
      message: `Nota de crédito ${r.numero} emitida (CAE ${r.cae})${r.colppyPendiente ? '. ATENCIÓN: no se pudo registrar en Colppy, reintentar.' : r.colppyBorradorFce ? '. En Colppy quedó como BORRADOR: tildá "Factura de crédito electrónica MiPyME (FCE)" y aprobala.' : ' y registrada en Colppy'}`,
    })
  } catch (e) {
    if (e instanceof NotaCreditoError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    logger.error('[NC] Error emitiendo nota de crédito:', e)
    return NextResponse.json({ error: (e as Error).message || 'Error al emitir la nota de crédito' }, { status: 500 })
  }
}

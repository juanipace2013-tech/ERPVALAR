/**
 * GET  /api/facturas/[id]/nota-credito — líneas de la factura con lo disponible
 *      para devolver (NC por unidades) y el contexto para la vista previa.
 * POST /api/facturas/[id]/nota-credito — emite una nota de crédito (ARCA) sobre
 * una factura emitida por el ERP y la registra en Colppy.
 *   body: { modo: 'UNIDADES', unidades: [{ index, cantidad }], motivo? }  (devolución)
 *      o  { modo: 'IMPORTE', netoParcial, motivo? }                      (ajuste)
 *      o  { modo: 'TOTAL', motivo? }                                     (anula la factura)
 *   modo es obligatorio: un comprobante fiscal no se emite deduciendo la intención.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import {
  emitirNotaCredito,
  NotaCreditoError,
  obtenerLineasNcUnidades,
  type ModoNotaCredito,
} from '@/lib/facturacion/nota-credito-arca'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

const MODOS: ModoNotaCredito[] = ['TOTAL', 'IMPORTE', 'UNIDADES']

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { id } = await params
  try {
    const r = await obtenerLineasNcUnidades(id)
    if (!r) return NextResponse.json({ error: 'La factura no tiene el detalle de líneas para devolver por unidades' }, { status: 404 })
    return NextResponse.json(r)
  } catch (e) {
    logger.error('[NC] Error cargando las líneas para NC por unidades', { invoiceId: id, error: (e as Error).message })
    return NextResponse.json({ error: 'No se pudieron cargar las líneas de la factura' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const role = (session.user as { role?: string }).role
  if (role && !['ADMIN', 'GERENTE', 'CONTADOR'].includes(role)) {
    return NextResponse.json({ error: 'Sin permisos para emitir notas de crédito' }, { status: 403 })
  }
  const { id } = await params
  let body: { modo?: string; motivo?: string; netoParcial?: unknown; unidades?: unknown; pendienteEnCotizacion?: unknown } = {}
  try {
    const parsed = await request.json()
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed
  } catch {
    /* sin body */
  }

  // Validación del pedido: nada ambiguo llega a emitir un comprobante fiscal
  if (!MODOS.includes(body.modo as ModoNotaCredito)) {
    return NextResponse.json({ error: `Indicá el tipo de nota de crédito (UNIDADES, IMPORTE o TOTAL)` }, { status: 400 })
  }
  if (body.unidades !== undefined && !Array.isArray(body.unidades)) {
    return NextResponse.json({ error: 'unidades tiene que ser una lista de { index, cantidad }' }, { status: 400 })
  }
  const unidades = Array.isArray(body.unidades)
    ? (body.unidades as Array<{ index?: unknown; cantidad?: unknown }>).map((u) => ({
        index: typeof u?.index === 'number' ? u.index : NaN,
        cantidad: typeof u?.cantidad === 'number' ? u.cantidad : NaN,
      }))
    : undefined
  if (unidades?.some((u) => !Number.isInteger(u.index) || u.index < 0 || !Number.isFinite(u.cantidad) || u.cantidad < 0)) {
    return NextResponse.json({ error: 'Línea o cantidad inválida en la devolución' }, { status: 400 })
  }
  const netoParcial = body.netoParcial === undefined ? undefined : typeof body.netoParcial === 'number' ? body.netoParcial : NaN
  if (netoParcial !== undefined && !Number.isFinite(netoParcial)) {
    return NextResponse.json({ error: 'El neto del ajuste no es un número válido' }, { status: 400 })
  }

  try {
    const r = await emitirNotaCredito(id, {
      userId: session.user.id,
      motivo: typeof body.motivo === 'string' ? body.motivo : undefined,
      modo: body.modo as ModoNotaCredito | undefined,
      netoParcial,
      unidades,
      pendienteEnCotizacion: body.pendienteEnCotizacion === true,
    })
    logAudit({
      userId: session.user.id,
      userName: session.user.name || '',
      userEmail: session.user.email || '',
      action: 'CREATE',
      entity: 'INVOICE',
      entityId: r.invoiceId,
      entityRef: r.numero,
      description: `Nota de crédito ${r.esTotal ? 'total' : r.modo === 'UNIDADES' ? 'por unidades (devolución)' : 'parcial'} ${r.numero} (CAE ${r.cae}) por ${r.total} sobre factura ${id}${body.motivo ? ` — ${body.motivo}` : ''}${r.colppyPendiente ? ' [PENDIENTE Colppy]' : r.colppyBorradorFce ? ' [BORRADOR FCE en Colppy]' : ''}${r.advertencias.length ? ` [${r.advertencias.join(' ')}]` : ''}`,
    })
    return NextResponse.json({
      ...r,
      pdfUrl: `/api/facturas/${r.invoiceId}/pdf`,
      message: `Nota de crédito ${r.numero} emitida (CAE ${r.cae})${r.colppyPendiente ? '. ATENCIÓN: no se pudo registrar en Colppy, reintentar.' : r.colppyBorradorFce ? '. En Colppy quedó como BORRADOR: tildá "Factura de crédito electrónica MiPyME (FCE)" y aprobala.' : r.colppyImputada ? ' y registrada en Colppy, aplicada a la factura' : ' y registrada en Colppy'}`,
    })
  } catch (e) {
    if (e instanceof NotaCreditoError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    logger.error('[NC] Error emitiendo nota de crédito:', e)
    return NextResponse.json({ error: (e as Error).message || 'Error al emitir la nota de crédito' }, { status: 500 })
  }
}

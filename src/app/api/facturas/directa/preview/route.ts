/**
 * POST /api/facturas/directa/preview — vista previa de una factura directa,
 * SIN efectos (lee la DB, el padrón de ARCA y Mercado Libre). Mismo body que
 * POST /api/facturas/directa (idempotencyKey no hace falta).
 *
 * 200 { ok, letra, cbteTipoPrevisto, esFce, receptor: { docTipo, docNro, condicionIvaId },
 *       totales: { neto, iva, total, totalArs }, preciosConIva, condicionPago,
 *       fechaFactura, fechaVto (YYYY-MM-DD), errores: [{ codigo, mensaje, linea? }],
 *       avisos: [...], confirmacionesRequeridas: [{ codigo, mensaje, firma }],
 *       padron: {...} | null, ml: {...} | null, cliente: {...}, tipoCambioReferencia }
 * 400 body mal formado · 401/403 · 404 cliente inexistente.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole, ROLES } from '@/lib/authz'
import { logger } from '@/lib/logger'
import { validarPedidoFacturaDirecta } from '@/lib/facturacion/factura-directa-form'
import { FacturaDirectaError, previsualizarFacturaDirecta } from '@/lib/facturacion/factura-directa'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const forbidden = requireRole(session, ROLES.FINANZAS, 'Sin permisos para emitir facturas directas')
  if (forbidden) return forbidden

  const body = await req.json().catch(() => null)
  const { pedido, errores } = validarPedidoFacturaDirecta(body)
  if (!pedido) {
    return NextResponse.json({ error: errores.join(' · ') || 'Pedido inválido', codigo: 'PEDIDO_INVALIDO', errores }, { status: 400 })
  }

  try {
    return NextResponse.json(await previsualizarFacturaDirecta(pedido))
  } catch (e) {
    if (e instanceof FacturaDirectaError) {
      return NextResponse.json({ error: e.message, codigo: e.codigo, ...e.extra }, { status: e.status })
    }
    logger.error('[Factura directa] Error en la vista previa', { customerId: pedido.customerId, error: (e as Error).message })
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

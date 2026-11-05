/**
 * POST /api/pagos-proveedores/preview — calcula la orden de pago sin registrarla:
 * neto de cada factura, retención de Ganancias (con los pagos del mes en Colppy)
 * y total a pagar. Mismo cálculo que el registro. Solo lectura.
 * Body: { supplierId, fecha, pagos: { [idFacturaColppy]: importe }, retencionManual?, sinRetencion? }
 * Roles: ADMIN, GERENTE, CONTADOR.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole, ROLES } from '@/lib/authz'
import { logger } from '@/lib/logger'
import { OrdenPagoError, previsualizarOrdenDePago, validarPedidoOrdenPago } from '@/lib/pagos-proveedores/registrar'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const forbidden = requireRole(session, ROLES.FINANZAS)
  if (forbidden) return forbidden

  try {
    const pedido = validarPedidoOrdenPago(await req.json().catch(() => null), { requiereClave: false })
    return NextResponse.json(await previsualizarOrdenDePago(pedido))
  } catch (e) {
    if (e instanceof OrdenPagoError) return NextResponse.json({ error: e.message, codigo: e.codigo, ...e.extra }, { status: e.status })
    logger.error('[Pagos proveedores] Error en vista previa', { error: (e as Error).message })
    return NextResponse.json({ error: `No se pudo leer Colppy: ${(e as Error).message}`, codigo: 'COLPPY_LECTURA' }, { status: 502 })
  }
}

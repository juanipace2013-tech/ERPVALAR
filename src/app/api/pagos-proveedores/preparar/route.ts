/**
 * GET /api/pagos-proveedores/preparar?supplierId=&fecha=YYYY-MM-DD
 * Lee de Colppy lo que necesita la pantalla de nueva orden de pago: régimen de
 * retención del proveedor, facturas impagas, bancos en pesos, pagos del mes y
 * próximo número de OP. Solo lectura.
 * Roles: ADMIN, GERENTE, CONTADOR.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole, ROLES } from '@/lib/authz'
import { logger } from '@/lib/logger'
import { OrdenPagoError, prepararOrdenDePago } from '@/lib/pagos-proveedores/registrar'

export const maxDuration = 120

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const forbidden = requireRole(session, ROLES.FINANZAS)
  if (forbidden) return forbidden

  const supplierId = req.nextUrl.searchParams.get('supplierId') || ''
  const fecha = req.nextUrl.searchParams.get('fecha') || ''
  if (!supplierId) return NextResponse.json({ error: 'Falta el proveedor', codigo: 'PEDIDO_INVALIDO' }, { status: 400 })
  try {
    return NextResponse.json(await prepararOrdenDePago(supplierId, fecha))
  } catch (e) {
    if (e instanceof OrdenPagoError) return NextResponse.json({ error: e.message, codigo: e.codigo, ...e.extra }, { status: e.status })
    logger.error('[Pagos proveedores] Error preparando', { supplierId, error: (e as Error).message })
    return NextResponse.json({ error: `No se pudo leer Colppy: ${(e as Error).message}`, codigo: 'COLPPY_LECTURA' }, { status: 502 })
  }
}

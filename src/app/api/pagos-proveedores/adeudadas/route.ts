/**
 * GET /api/pagos-proveedores/adeudadas?supplierId= — facturas adeudadas al
 * proveedor, en vivo de Colppy (Proveedor/facturas_impagas_proveedor), con el
 * saldo total. Solo lectura. Lo usa el panel del proveedor (Proveedores →
 * Gestión) para la pestaña "Facturas adeudadas".
 * Roles: ADMIN, GERENTE, CONTADOR.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole, ROLES } from '@/lib/authz'
import { logger } from '@/lib/logger'
import { OrdenPagoError, facturasAdeudadas } from '@/lib/pagos-proveedores/registrar'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const forbidden = requireRole(session, ROLES.FINANZAS)
  if (forbidden) return forbidden

  const supplierId = req.nextUrl.searchParams.get('supplierId') || ''
  if (!supplierId) return NextResponse.json({ error: 'Falta el proveedor', codigo: 'PEDIDO_INVALIDO' }, { status: 400 })
  try {
    return NextResponse.json(await facturasAdeudadas(supplierId))
  } catch (e) {
    if (e instanceof OrdenPagoError) return NextResponse.json({ error: e.message, codigo: e.codigo, ...e.extra }, { status: e.status })
    logger.error('[Pagos proveedores] Error leyendo adeudadas', { supplierId, error: (e as Error).message })
    return NextResponse.json({ error: `No se pudo leer Colppy: ${(e as Error).message}`, codigo: 'COLPPY_LECTURA' }, { status: 502 })
  }
}

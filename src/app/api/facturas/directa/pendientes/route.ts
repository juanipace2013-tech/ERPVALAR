/**
 * GET /api/facturas/directa/pendientes — facturas directas para resolver (banner
 * de /facturas/nueva): INCIERTA (ARCA no confirmó el CAE), HUERFANA (CAE sin
 * Invoice en el ERP) y TRABADA (EMITIENDO que se cortó). Se resuelven con
 * scripts/factura-directa-reconciliar.ts; nunca reintentando la emisión.
 *
 * 200 { pendientes: [{ id, tipo, estado, customerId, cliente, letra, cbteTipo, numero,
 *       cae, total, currency, mlPackId, error, createdAt, mensaje }] }
 */
import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import { requireRole, ROLES } from '@/lib/authz'
import { logger } from '@/lib/logger'
import { listarPendientesFacturaDirecta } from '@/lib/facturacion/factura-directa'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const forbidden = requireRole(session, ROLES.FINANZAS, 'Sin permisos para emitir facturas directas')
  if (forbidden) return forbidden

  try {
    return NextResponse.json({ pendientes: await listarPendientesFacturaDirecta() })
  } catch (e) {
    logger.error('[Factura directa] Error listando pendientes', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

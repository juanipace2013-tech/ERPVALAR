/**
 * GET /api/cobros/preparar?customerId=
 * Lee de Colppy lo que necesita la pantalla de nuevo cobro: comprobantes
 * impagos del cliente, cuentas en pesos y próximo número de recibo. Solo lectura.
 * Roles: ADMIN, GERENTE, CONTADOR.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole, ROLES } from '@/lib/authz'
import { logger } from '@/lib/logger'
import { CobroError, prepararCobro } from '@/lib/cobros-colppy/registrar'

export const maxDuration = 120

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const forbidden = requireRole(session, ROLES.FINANZAS)
  if (forbidden) return forbidden

  const customerId = req.nextUrl.searchParams.get('customerId') || ''
  if (!customerId) return NextResponse.json({ error: 'Falta el cliente', codigo: 'PEDIDO_INVALIDO' }, { status: 400 })
  try {
    return NextResponse.json(await prepararCobro(customerId))
  } catch (e) {
    if (e instanceof CobroError) return NextResponse.json({ error: e.message, codigo: e.codigo, ...e.extra }, { status: e.status })
    logger.error('[Cobros] Error preparando', { customerId, error: (e as Error).message })
    return NextResponse.json({ error: `No se pudo leer Colppy: ${(e as Error).message}`, codigo: 'COLPPY_LECTURA' }, { status: 502 })
  }
}

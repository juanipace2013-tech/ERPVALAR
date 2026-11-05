/**
 * POST /api/pagos-proveedores/[id]/verificar — para una orden INCIERTA (se cortó
 * sin respuesta de Colppy): busca su número en los pagos del proveedor en
 * Colppy. Encontrada → REGISTRADA; no encontrada → ERROR (se puede reintentar).
 * Roles: ADMIN, GERENTE, CONTADOR.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole, ROLES } from '@/lib/authz'
import { logger } from '@/lib/logger'
import { OrdenPagoError, verificarOrdenDePago } from '@/lib/pagos-proveedores/registrar'

export const maxDuration = 120

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const forbidden = requireRole(session, ROLES.FINANZAS)
  if (forbidden) return forbidden

  const { id } = await params
  try {
    return NextResponse.json(await verificarOrdenDePago(id))
  } catch (e) {
    if (e instanceof OrdenPagoError) return NextResponse.json({ error: e.message, codigo: e.codigo, ...e.extra }, { status: e.status })
    logger.error('[Pagos proveedores] Error verificando', { id, error: (e as Error).message })
    return NextResponse.json({ error: `No se pudo leer Colppy: ${(e as Error).message}`, codigo: 'COLPPY_LECTURA' }, { status: 502 })
  }
}

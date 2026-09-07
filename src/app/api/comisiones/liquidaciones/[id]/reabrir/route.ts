import { NextRequest, NextResponse } from 'next/server'

import { auth } from '@/auth'
import { logger } from '@/lib/logger'
import { reabrir } from '@/lib/comisiones/liquidacion'
import { requireRole, ROLES } from '@/lib/authz'

// POST /api/comisiones/liquidaciones/[id]/reabrir — vuelve la liquidación a
// ABIERTA (las líneas se recalculan de nuevo con el tramo provisorio).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const forbidden = requireRole(session, ROLES.GESTION)
    if (forbidden) return forbidden

    const { id } = await params
    const liquidacion = await reabrir(id)
    return NextResponse.json({ liquidacion })
  } catch (e) {
    logger.error('[comisiones/reabrir] POST error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

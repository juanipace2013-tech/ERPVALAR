/**
 * POST /api/mercadolibre/publicaciones/sync-stock
 *   Body opcional: { linkIds?: string[] }
 *   Sync manual Colppy -> ERP -> ML para las publicaciones vinculadas.
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { syncStockToMl } from '@/lib/mercadolibre/listings'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const body = (await req.json().catch(() => ({}))) as { linkIds?: string[] }
    return NextResponse.json(await syncStockToMl({ linkIds: body.linkIds }))
  } catch (error) {
    logger.error('[ML Stock] Error en sync manual', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al sincronizar stock' },
      { status: 500 }
    )
  }
}

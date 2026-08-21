/**
 * GET /api/cron/sync-ml-stock?secret=CRON_SECRET
 *
 * Sync horario de stock Colppy -> ERP -> Mercado Libre para las publicaciones
 * vinculadas (MlItemLink LINKED + syncEnabled). Sin ?secret devuelve el estado
 * de la última corrida.
 */

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { syncStockToMl, type StockSyncResult } from '@/lib/mercadolibre/listings'

export const maxDuration = 600

let lastRun: { completedAt: string; result: StockSyncResult; durationMs: number } | null = null

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (!secret) return NextResponse.json({ lastRun })
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const started = Date.now()
  try {
    const result = await syncStockToMl()
    lastRun = { completedAt: new Date().toISOString(), result, durationMs: Date.now() - started }
    return NextResponse.json(lastRun)
  } catch (error) {
    logger.error('[ML Stock] Error en cron', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 }
    )
  }
}

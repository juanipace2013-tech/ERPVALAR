/**
 * GET /api/cron/sync-ml-stock?secret=CRON_SECRET
 *
 * Sync horario de stock Colppy -> ERP -> Mercado Libre para las publicaciones
 * vinculadas (MlItemLink LINKED + syncEnabled). Sin ?secret devuelve el estado
 * de la última corrida (persistido en cron_runs). Si ya hay una corrida en
 * curso responde 409 sin ejecutar.
 */

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { syncStockToMl, type StockSyncResult } from '@/lib/mercadolibre/listings'
import { runCronJob, getCronStatus, cronSkippedResponse, type CronJob } from '@/lib/cron-run'

export const maxDuration = 600

const JOB: CronJob = 'sync-ml-stock'

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (!secret) {
    const { last, running } = await getCronStatus(JOB)
    return NextResponse.json({
      lastRun:
        last?.status === 'OK'
          ? { completedAt: last.finishedAt, result: last.result as unknown as StockSyncResult, durationMs: last.durationMs }
          : null,
      lastError: last?.status === 'ERROR' ? { at: last.finishedAt, error: last.error } : null,
      running: running ? { since: running.startedAt } : null,
    })
  }
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const outcome = await runCronJob(JOB, () => syncStockToMl())
    if (outcome.skipped) {
      return NextResponse.json(cronSkippedResponse(outcome.reason), { status: 409 })
    }
    return NextResponse.json({
      completedAt: new Date().toISOString(),
      result: outcome.result,
      durationMs: outcome.durationMs,
    })
  } catch (error) {
    logger.error('[ML Stock] Error en cron', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/cron/ingest-stock-winters
 *
 * Importa la planilla semanal de stock WINAR desde el mail de WINTERS
 * (WINTERS_STOCK_MAILBOX). Pensado para correr una vez por día vía crontab
 * del VPS: el mail llega los lunes a la mañana y las corridas siguientes
 * salen en ALREADY_IMPORTED sin tocar nada.
 *
 * Modos:
 *   GET /api/cron/ingest-stock-winters
 *     → { lastRun: {...} | null }   (estado del último run, público para UI)
 *
 *   GET /api/cron/ingest-stock-winters?secret=CRON_SECRET&lookbackDays=30
 *     → busca el mail más nuevo y, si no está importado, reemplaza winters_stock.
 *
 * Mismo patrón de auth, lock y forma de respuesta que los otros /api/cron/*.
 */

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { runCronJob, getCronStatus, cronSkippedResponse, type CronJob } from '@/lib/cron-run'
import { ingestStockWinters, type WintersIngestResult } from '@/lib/winters-stock/mail-ingest'

const JOB: CronJob = 'ingest-stock-winters'

export const maxDuration = 120

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')

  if (!secret) {
    const { last, running } = await getCronStatus(JOB)
    return NextResponse.json({
      lastRun: last?.status === 'OK' ? (last.result as unknown as WintersIngestResult) : null,
      lastError: last?.status === 'ERROR' ? { at: last.finishedAt, error: last.error } : null,
      running: running ? { since: running.startedAt } : null,
    })
  }

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const lookbackRaw = Number(req.nextUrl.searchParams.get('lookbackDays'))
  const lookbackDays = Number.isFinite(lookbackRaw) && lookbackRaw > 0 ? lookbackRaw : undefined

  try {
    const outcome = await runCronJob(JOB, () => ingestStockWinters({ lookbackDays }))
    if (outcome.skipped) {
      return NextResponse.json(cronSkippedResponse(outcome.reason), { status: 409 })
    }
    return NextResponse.json({ status: 'ok', ...outcome.result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('[CRON ingest-stock-winters] Error en la corrida', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

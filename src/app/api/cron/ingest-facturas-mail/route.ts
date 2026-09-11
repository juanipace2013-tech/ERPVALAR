/**
 * GET /api/cron/ingest-facturas-mail
 *
 * Carga facturas de compra desde la casilla de facturación (FACTURACION_MAILBOX)
 * para los remitentes de src/lib/purchase-invoices/mail-ingest/senders.ts.
 * Pensado para correr cada 15 minutos vía crontab del VPS.
 *
 * Modos:
 *   GET /api/cron/ingest-facturas-mail
 *     → { lastRun: {...} | null }   (estado del último run, público para UI)
 *
 *   GET /api/cron/ingest-facturas-mail?secret=CRON_SECRET
 *     → barre los mails de los últimos FACTURACION_MAIL_LOOKBACK_DAYS (default 7),
 *       crea las facturas nuevas con flag de revisión y registra cada adjunto.
 *
 *   GET /api/cron/ingest-facturas-mail?secret=CRON_SECRET&dryRun=1&lookbackDays=30
 *     → hace Graph + OCR + matcheo y devuelve qué crearía, sin tocar la DB.
 *       Para probar en prod antes de activar el cron.
 *
 *   GET /api/cron/ingest-facturas-mail?secret=CRON_SECRET&dryRun=1&recheck=1&limit=5
 *     → además ignora la deduplicación: pasa por OCR los últimos 5 mails
 *       aunque sus facturas ya estén cargadas y devuelve la existente al lado
 *       (total, items) para comparar la lectura del bot con la carga manual.
 *
 * Mismo patrón de auth, lock y forma de respuesta que los otros /api/cron/*.
 */

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { runCronJob, getCronStatus, cronSkippedResponse, type CronJob } from '@/lib/cron-run'
import { ingestFacturasMail, type IngestRunResult } from '@/lib/purchase-invoices/mail-ingest'

const JOB: CronJob = 'ingest-facturas-mail'

// OCR de varios PDFs puede pasar los 60s
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')

  if (!secret) {
    const { last, running } = await getCronStatus(JOB)
    return NextResponse.json({
      lastRun: last?.status === 'OK' ? (last.result as unknown as IngestRunResult) : null,
      lastError: last?.status === 'ERROR' ? { at: last.finishedAt, error: last.error } : null,
      running: running ? { since: running.startedAt } : null,
    })
  }

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = req.nextUrl.searchParams
  const dryRun = params.get('dryRun') === '1'
  const recheck = params.get('recheck') === '1'
  const positive = (name: string) => {
    const n = Number(params.get(name))
    return Number.isFinite(n) && n > 0 ? n : undefined
  }

  try {
    const outcome = await runCronJob(JOB, () =>
      ingestFacturasMail({ dryRun, recheck, lookbackDays: positive('lookbackDays'), limit: positive('limit') })
    )
    if (outcome.skipped) {
      return NextResponse.json(cronSkippedResponse(outcome.reason), { status: 409 })
    }
    return NextResponse.json({ status: 'ok', ...outcome.result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('[CRON ingest-facturas-mail] Error en la corrida', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

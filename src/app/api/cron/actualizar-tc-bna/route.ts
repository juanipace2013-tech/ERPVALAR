/**
 * GET /api/cron/actualizar-tc-bna?secret=CRON_SECRET
 *
 * Carga el tipo de cambio de facturación: dólar billete VENTA del BNA del
 * día hábil anterior (ver src/lib/tipo-cambio-bna.ts). Corre cada mañana
 * via cron del servidor, antes del horario laboral.
 *
 * GET sin ?secret devuelve el estado de la última corrida (cron_runs).
 */

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { runCronJob, getCronStatus, cronSkippedResponse, type CronJob } from '@/lib/cron-run'
import { actualizarTipoCambioBNA } from '@/lib/tipo-cambio-bna'

const JOB: CronJob = 'actualizar-tc-bna'

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')

  // Sin secret → estado de la última corrida (público para la UI)
  if (!secret) {
    const { last, running } = await getCronStatus(JOB)
    return NextResponse.json({
      last: last
        ? { status: last.status, finishedAt: last.finishedAt, result: last.result, error: last.error }
        : null,
      running: running ? { since: running.startedAt } : null,
    })
  }

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const outcome = await runCronJob(JOB, actualizarTipoCambioBNA)
    if (outcome.skipped) {
      return NextResponse.json(cronSkippedResponse(outcome.reason), { status: 409 })
    }
    return NextResponse.json({ status: 'ok', ...outcome.result })
  } catch (error: any) {
    logger.error('[CRON] actualizar-tc-bna FAILED:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

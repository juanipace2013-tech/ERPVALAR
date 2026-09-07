/**
 * GET /api/cron/check-ml-moderation?secret=CRON_SECRET
 *
 * Barrido de moderación asíncrona de la mensajería post-venta de ML: los
 * mensajes SENT de las últimas 48 h se re-chequean contra la API y, si ML los
 * rechazó después del envío (ej. "automatic_message"), pasan a MODERATED.
 * Barre también los auto-replies (texto completo enviado al responder el
 * comprador) por el mismo motivo.
 * Sin ?secret devuelve el estado de la última corrida (persistido en
 * cron_runs). Si ya hay una corrida en curso responde 409 sin ejecutar.
 */

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { sweepSentModeration } from '@/lib/mercadolibre/handlePostSale'
import { sweepAutoReplyModeration } from '@/lib/mercadolibre/handleBuyerReply'
import { sweepMissedAutoReplies } from '@/lib/mercadolibre/sweepMissedAutoReplies'
import { runCronJob, getCronStatus, cronSkippedResponse, type CronJob } from '@/lib/cron-run'

export const maxDuration = 300

const JOB: CronJob = 'check-ml-moderation'

interface SweepResult {
  result: { checked: number; moderated: number }
  autoReplies: { checked: number; moderated: number }
  missedReplies: { checked: number; repaired: number; alerted: number }
}

async function barrer(): Promise<SweepResult> {
  const result = await sweepSentModeration()
  const autoReplies = await sweepAutoReplyModeration()
  const missedReplies = await sweepMissedAutoReplies()
  if (result.moderated > 0) {
    logger.warn(`[ML PostSale] Sweep: ${result.moderated}/${result.checked} pasaron a MODERATED`)
  }
  if (autoReplies.moderated > 0) {
    logger.warn(
      `[ML AutoReply] Sweep: ${autoReplies.moderated}/${autoReplies.checked} auto-replies pasaron a MODERATED`
    )
  }
  return { result, autoReplies, missedReplies }
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (!secret) {
    const { last, running } = await getCronStatus(JOB)
    return NextResponse.json({
      lastRun:
        last?.status === 'OK'
          ? { completedAt: last.finishedAt, ...(last.result as unknown as SweepResult), durationMs: last.durationMs }
          : null,
      lastError: last?.status === 'ERROR' ? { at: last.finishedAt, error: last.error } : null,
      running: running ? { since: running.startedAt } : null,
    })
  }
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const outcome = await runCronJob(JOB, barrer)
    if (outcome.skipped) {
      return NextResponse.json(cronSkippedResponse(outcome.reason), { status: 409 })
    }
    return NextResponse.json({
      completedAt: new Date().toISOString(),
      ...outcome.result,
      durationMs: outcome.durationMs,
    })
  } catch (error) {
    logger.error('[ML PostSale] Error en cron de moderación', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 }
    )
  }
}

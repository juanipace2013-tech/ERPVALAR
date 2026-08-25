/**
 * GET /api/cron/check-ml-moderation?secret=CRON_SECRET
 *
 * Barrido de moderación asíncrona de la mensajería post-venta de ML: los
 * mensajes SENT de las últimas 48 h se re-chequean contra la API y, si ML los
 * rechazó después del envío (ej. "automatic_message"), pasan a MODERATED.
 * Sin ?secret devuelve el estado de la última corrida.
 */

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { sweepSentModeration } from '@/lib/mercadolibre/handlePostSale'

export const maxDuration = 300

let lastRun: {
  completedAt: string
  result: { checked: number; moderated: number }
  durationMs: number
} | null = null

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (!secret) return NextResponse.json({ lastRun })
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const started = Date.now()
  try {
    const result = await sweepSentModeration()
    lastRun = { completedAt: new Date().toISOString(), result, durationMs: Date.now() - started }
    if (result.moderated > 0) {
      logger.warn(`[ML PostSale] Sweep: ${result.moderated}/${result.checked} pasaron a MODERATED`)
    }
    return NextResponse.json(lastRun)
  } catch (error) {
    logger.error('[ML PostSale] Error en cron de moderación', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/cron/renew-graph-subscriptions
 *
 * Renueva las suscripciones de Microsoft Graph antes de que expiren.
 * Las subs sobre /messages duran como mucho ~71hs, así que las renovamos
 * cuando entran a la ventana de 48h pre-vencimiento. Pensado para correr
 * cada 6 horas vía crontab del VPS (misma cadencia que sync-balances pero
 * 4x al día).
 *
 * Modos:
 *   GET /api/cron/renew-graph-subscriptions
 *     → { lastRun: {...} | null }   (estado del último run, público para UI)
 *
 *   GET /api/cron/renew-graph-subscriptions?secret=CRON_SECRET
 *     → ejecuta el barrido: busca subs por vencer, las renueva una a una,
 *       persiste el nuevo expiresAt. Errores per-item no abortan el batch.
 *
 *   GET /api/cron/renew-graph-subscriptions?secret=CRON_SECRET&force=1
 *     → ignora el threshold de 48h y renueva TODAS las subs del registro.
 *       Útil para debug local o forzar una renovación inmediata.
 *
 * Mismo patrón de auth y forma de respuesta que /api/cron/sync-balances.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { renewMailSubscription, defaultMailSubscriptionExpiration } from '@/lib/inbox/graph-mail'

// ─── Config ──────────────────────────────────────────────────────────────────

/** Renovar cuando expira en menos de 48h (Graph permite hasta ~71h máximo). */
const THRESHOLD_MS = 48 * 60 * 60 * 1000

// ─── Estado en memoria (se pierde al reiniciar PM2 — solo para UI/monitoreo) ─

interface SubscriptionRunDetail {
  subscriptionId: string
  result: 'renewed' | 'skipped' | 'failed_dead' | 'failed_transient'
  reason?: string
  previousExpiresAt?: string
  newExpiresAt?: string
  error?: string
}

interface LastRun {
  completedAt: string
  renewed: number
  failed: number
  skipped: number
  totalInDb: number
  duration: string
  details: SubscriptionRunDetail[]
}

let lastRun: LastRun | null = null

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Identifica si un error de Graph corresponde a una subscription muerta
 * (borrada del lado de Microsoft). Esos errores no se reintentan — la única
 * salida es crear una nueva con POST /api/inbox/graph/setup.
 *
 * Graph devuelve 404 NotFound o 410 Gone para subs muertas. Parseo el
 * mensaje porque `renewMailSubscription` tira un Error con el status code
 * embebido en el texto: "Graph subscription renew falló: 404 ...".
 */
function isDeadSubscriptionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const m = err.message.match(/falló:\s*(\d{3})/)
  if (!m) return false
  const status = Number(m[1])
  return status === 404 || status === 410
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')

  // Sin secret → devolver estado de última corrida (público para la UI)
  if (!secret) {
    return NextResponse.json({ lastRun })
  }

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const force = req.nextUrl.searchParams.get('force') === '1'
  const startTime = Date.now()

  // Snapshot de TODAS las subs para reportar totales correctamente
  const allSubs = await prisma.graphSubscription.findMany({
    orderBy: { expiresAt: 'asc' },
  })

  // Decidir cuáles entran al batch de renovación
  const cutoff = new Date(Date.now() + THRESHOLD_MS)
  const targets = force
    ? allSubs
    : allSubs.filter((s) => s.expiresAt.getTime() < cutoff.getTime())

  const details: SubscriptionRunDetail[] = []
  let renewed = 0
  let failed = 0

  // Las que NO entran al batch — reportarlas como skipped
  if (!force) {
    for (const sub of allSubs) {
      if (sub.expiresAt.getTime() >= cutoff.getTime()) {
        details.push({
          subscriptionId: sub.subscriptionId,
          result: 'skipped',
          reason: `Expira en más de 48h (${sub.expiresAt.toISOString()})`,
          previousExpiresAt: sub.expiresAt.toISOString(),
        })
      }
    }
  }

  // Renovar las que entran — secuencial, per-item try/catch
  for (const sub of targets) {
    const newExpirationRequest = defaultMailSubscriptionExpiration()
    try {
      const response = await renewMailSubscription(sub.subscriptionId, newExpirationRequest)
      // Graph puede ajustar la expiración pedida — usamos la que devuelve
      const newExpiresAt = new Date(response.expirationDateTime)

      await prisma.graphSubscription.update({
        where: { id: sub.id },
        data: { expiresAt: newExpiresAt },
      })

      renewed++
      details.push({
        subscriptionId: sub.subscriptionId,
        result: 'renewed',
        previousExpiresAt: sub.expiresAt.toISOString(),
        newExpiresAt: newExpiresAt.toISOString(),
      })

      logger.info(
        `[CRON renew-graph] Renovada subscription=${sub.subscriptionId} hasta ${newExpiresAt.toISOString()}`
      )
    } catch (err) {
      failed++
      const errMsg = err instanceof Error ? err.message : String(err)

      if (isDeadSubscriptionError(err)) {
        details.push({
          subscriptionId: sub.subscriptionId,
          result: 'failed_dead',
          previousExpiresAt: sub.expiresAt.toISOString(),
          error: errMsg,
        })
        logger.warn(
          `[CRON renew-graph] Subscription ${sub.subscriptionId} parece MUERTA del lado de Graph ` +
            `(404/410). Acción requerida: crear una nueva con POST /api/inbox/graph/setup. ` +
            `Error: ${errMsg}`
        )
      } else {
        details.push({
          subscriptionId: sub.subscriptionId,
          result: 'failed_transient',
          previousExpiresAt: sub.expiresAt.toISOString(),
          error: errMsg,
        })
        logger.error(
          `[CRON renew-graph] Error transitorio renovando ${sub.subscriptionId}: ${errMsg}`
        )
      }
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  const skipped = details.filter((d) => d.result === 'skipped').length

  lastRun = {
    completedAt: new Date().toISOString(),
    renewed,
    failed,
    skipped,
    totalInDb: allSubs.length,
    duration: `${duration}s`,
    details,
  }

  logger.info(
    `[CRON renew-graph] Completado: renewed=${renewed} failed=${failed} skipped=${skipped} total=${allSubs.length} duration=${duration}s${force ? ' (force=1)' : ''}`
  )

  return NextResponse.json({
    status: 'ok',
    renewed,
    failed,
    skipped,
    totalInDb: allSubs.length,
    duration: `${duration}s`,
    force,
    details,
  })
}

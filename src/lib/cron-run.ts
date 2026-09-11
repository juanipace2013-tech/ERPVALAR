/**
 * Registro y lock de corridas de crons (/api/cron/*).
 *
 * Antes cada cron guardaba su "última corrida" en una variable de módulo: se
 * perdía al reiniciar pm2 y, con dos servidores, cada uno veía la suya.
 * Ahora cada corrida es una fila en cron_runs y el lock evita que dos
 * invocaciones del mismo job corran a la vez (pasó el 3/9/2026 con
 * sync-balances mientras convivían el VPS viejo y el droplet).
 *
 * El lock usa pg_advisory_xact_lock dentro de la transacción de "adquirir":
 * funciona con el pooler de Supabase en modo transacción porque no depende
 * de mantener la conexión entre statements.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export type CronJob =
  | 'sync-balances'
  | 'sync-ml-stock'
  | 'check-ml-moderation'
  | 'renew-graph-subscriptions'
  | 'ingest-facturas-mail'

/** Una corrida RUNNING más vieja que esto se considera colgada y se libera. */
const STALE_MS = 30 * 60 * 1000

export interface CronRunInfo {
  id: string
  status: string
  startedAt: Date
  finishedAt: Date | null
  durationMs: number | null
  result: Prisma.JsonValue | null
  error: string | null
}

/**
 * Intenta registrar una corrida nueva. Devuelve null si ya hay una en curso.
 */
export async function acquireCronRun(job: CronJob, staleMs = STALE_MS): Promise<{ id: string } | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${job}))`

    const running = await tx.cronRun.findFirst({
      where: { job, status: 'RUNNING', startedAt: { gt: new Date(Date.now() - staleMs) } },
      select: { id: true },
    })
    if (running) return null

    // Corridas RUNNING viejas: el proceso murió sin cerrarlas.
    await tx.cronRun.updateMany({
      where: { job, status: 'RUNNING' },
      data: { status: 'ERROR', error: 'Corrida colgada: no terminó en el tiempo máximo', finishedAt: new Date() },
    })

    return tx.cronRun.create({ data: { job, status: 'RUNNING' }, select: { id: true } })
  })
}

export async function finishCronRun(id: string, status: 'OK' | 'ERROR', data: { result?: unknown; error?: string }) {
  const run = await prisma.cronRun.findUnique({ where: { id }, select: { startedAt: true } })
  const finishedAt = new Date()
  await prisma.cronRun.update({
    where: { id },
    data: {
      status,
      finishedAt,
      durationMs: run ? finishedAt.getTime() - run.startedAt.getTime() : null,
      result: data.result === undefined ? undefined : (data.result as Prisma.InputJsonValue),
      error: data.error ?? null,
    },
  })
}

export type CronOutcome<T> =
  | { skipped: true; reason: string }
  | { skipped: false; runId: string; result: T; durationMs: number }

/**
 * Corre `fn` bajo lock del job y deja la corrida registrada (OK o ERROR).
 * Si ya hay una corrida en curso devuelve { skipped: true } sin ejecutar.
 * Los errores de `fn` se registran y se vuelven a lanzar.
 */
export async function runCronJob<T>(job: CronJob, fn: () => Promise<T>): Promise<CronOutcome<T>> {
  const acquired = await acquireCronRun(job)
  if (!acquired) {
    logger.warn(`[CRON ${job}] Saltada: ya hay una corrida en curso`)
    return { skipped: true, reason: 'Ya hay una corrida en curso' }
  }
  const started = Date.now()
  try {
    const result = await fn()
    await finishCronRun(acquired.id, 'OK', { result })
    return { skipped: false, runId: acquired.id, result, durationMs: Date.now() - started }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishCronRun(acquired.id, 'ERROR', { error: message }).catch((e) =>
      logger.error(`[CRON ${job}] No se pudo registrar el error de la corrida`, e)
    )
    throw error
  }
}

/** Última corrida terminada (OK o ERROR) y si hay una en curso ahora. */
export async function getCronStatus(job: CronJob): Promise<{ last: CronRunInfo | null; running: CronRunInfo | null }> {
  const select = { id: true, status: true, startedAt: true, finishedAt: true, durationMs: true, result: true, error: true }
  const [last, running] = await Promise.all([
    prisma.cronRun.findFirst({ where: { job, status: { not: 'RUNNING' } }, orderBy: { startedAt: 'desc' }, select }),
    prisma.cronRun.findFirst({ where: { job, status: 'RUNNING' }, orderBy: { startedAt: 'desc' }, select }),
  ])
  return { last, running }
}

/** Respuesta 409 estándar cuando el cron se salta por lock. */
export function cronSkippedResponse(reason: string) {
  return { skipped: true, reason }
}

/**
 * GET /api/health
 *
 * Healthcheck público para monitoreo externo (UptimeRobot, Better Stack, etc.).
 * Verifica que la app responda y que la base conteste un SELECT 1.
 * Devuelve 503 si la base no responde, así el monitor alerta.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const startedAt = Date.now()

export async function GET() {
  const t0 = Date.now()
  let db: 'ok' | 'error' = 'ok'
  let dbError: string | undefined
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (e) {
    db = 'error'
    dbError = e instanceof Error ? e.message : String(e)
  }
  const body = {
    status: db === 'ok' ? 'ok' : 'degraded',
    db,
    dbMs: Date.now() - t0,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    ...(dbError ? { dbError } : {}),
  }
  return NextResponse.json(body, {
    status: db === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}

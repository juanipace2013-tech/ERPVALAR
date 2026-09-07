/**
 * GET /api/cron/sync-balances?secret=CRON_SECRET
 *
 * Sync liviano: solo actualiza Customer.balance desde Colppy.
 * NO toca nombre, CUIT, dirección, etc. — solo el saldo.
 * Corre diariamente a las 8:30 AR via cron del servidor.
 *
 * GET sin ?secret devuelve el estado de la última sincronización (persistido
 * en cron_runs, ver src/lib/cron-run.ts). Si ya hay una corrida en curso
 * responde 409 sin ejecutar.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { colppyLogin, colppyLogout, getColppyConfig, md5Hash, callColppyAPI, fetchAllColppyPages } from '@/lib/colppy'
import { logger } from '@/lib/logger'
import { runCronJob, getCronStatus, cronSkippedResponse, type CronJob } from '@/lib/cron-run'

const JOB: CronJob = 'sync-balances'

interface SyncResult {
  updated: number
  errors: number
  duration: string
}

// ─── Sync ───────────────────────────────────────────────────────────────────

async function sincronizarSaldos(): Promise<SyncResult> {
  const startTime = Date.now()
  let updated = 0
  let errors = 0

  // 1. Login Colppy
  const session = await colppyLogin()
  const config = getColppyConfig()
  const passwordMD5 = md5Hash(config.password)

  try {
    // 2. Traer todos los clientes de Colppy (solo necesitamos idCliente + Saldo).
    // Paginado: un limit fijo corta silenciosamente el listado.
    const colppyClients: any[] = await fetchAllColppyPages(async (start, limit) => {
      const listRes = await callColppyAPI<any>({
        auth: { usuario: config.user, password: passwordMD5 },
        service: { provision: 'Cliente', operacion: 'listar_cliente' },
        parameters: {
          sesion: { usuario: session.usuario, claveSesion: session.claveSesion },
          idEmpresa: session.idEmpresa,
          start,
          limit,
          filter: [],
          order: [{ field: 'NombreFantasia', dir: 'asc' }],
        },
      })

      if (!listRes.response?.success) {
        throw new Error('Error cargando clientes de Colppy')
      }

      return listRes.response.data || []
    })
    logger.info(`[CRON] Sync balances: ${colppyClients.length} clientes de Colppy`)

    // 3. Cargar mapa colppyId → id de la DB local
    const localCustomers = await prisma.customer.findMany({
      select: { id: true, colppyId: true },
      where: { colppyId: { not: null } },
    })
    const localByColppyId = new Map<string, string>()
    localCustomers.forEach((c) => {
      if (c.colppyId) localByColppyId.set(c.colppyId, c.id)
    })

    // 4. Actualizar balances en batches
    const BATCH_SIZE = 50

    for (let i = 0; i < colppyClients.length; i += BATCH_SIZE) {
      const batch = colppyClients.slice(i, i + BATCH_SIZE)
      const operations = []

      for (const c of batch) {
        const colppyId = String(c.idCliente || '')
        const localId = localByColppyId.get(colppyId)
        if (!localId) continue

        const balance = parseFloat(c.Saldo || '0')

        operations.push(
          prisma.customer
            .update({
              where: { id: localId },
              data: { balance },
            })
            .then(() => {
              updated++
            })
            .catch(() => {
              errors++
            })
        )
      }

      await Promise.allSettled(operations)
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    logger.info(`[CRON] Sync balances completed: ${updated} clients updated, ${errors} errors in ${duration}s`)
    return { updated, errors, duration: `${duration}s` }
  } finally {
    await colppyLogout(session).catch(() => {})
  }
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')

  // Sin secret → devolver estado de última sincronización (público para la UI)
  if (!secret) {
    const { last, running } = await getCronStatus(JOB)
    const lastSync =
      last?.status === 'OK'
        ? { completedAt: last.finishedAt?.toISOString() ?? null, ...(last.result as unknown as SyncResult) }
        : null
    return NextResponse.json({
      lastSync,
      lastError: last?.status === 'ERROR' ? { at: last.finishedAt, error: last.error } : null,
      running: running ? { since: running.startedAt } : null,
    })
  }

  // Con secret → ejecutar sync
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  try {
    const outcome = await runCronJob(JOB, sincronizarSaldos)
    if (outcome.skipped) {
      return NextResponse.json(cronSkippedResponse(outcome.reason), { status: 409 })
    }
    return NextResponse.json({ status: 'ok', ...outcome.result })
  } catch (error: any) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    logger.error(`[CRON] Sync balances FAILED after ${duration}s:`, error.message)

    return NextResponse.json(
      { error: error.message, duration: `${duration}s` },
      { status: 500 }
    )
  }
}

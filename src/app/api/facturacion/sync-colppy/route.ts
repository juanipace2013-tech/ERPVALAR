/**
 * POST /api/facturacion/sync-colppy
 * Inicia la sincronización de facturas desde Colppy en background y responde
 * inmediatamente (antes bloqueaba el request durante todo el paginado).
 * GET devuelve el estado para polling — mismo patrón que /api/clientes/sync-colppy.
 *
 * Body: { dateFrom?: string, dateTo?: string }
 * - Si no se proveen fechas, sincroniza desde 2026-01-01 hasta hoy.
 *
 * La lógica vive en src/lib/facturacion/sync-colppy.ts (compartida con el
 * cron diario scripts/sync-colppy-diario.ts).
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { syncColppyFacturas, type SyncColppyResumen } from '@/lib/facturacion/sync-colppy'

interface SyncStatus {
  running: boolean
  startedAt: number | null
  result: SyncColppyResumen | null
  error: string | null
}

// Estado en module scope (se reinicia al reiniciar PM2, aceptable)
let syncStatus: SyncStatus = { running: false, startedAt: null, result: null, error: null }

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    if (syncStatus.running) {
      return NextResponse.json({
        status: 'already_running',
        message: 'Sincronización ya en progreso',
        startedAt: syncStatus.startedAt,
      })
    }

    const body = await request.json().catch(() => ({}))
    const dateFrom = body.dateFrom
      ? new Date(body.dateFrom)
      : new Date('2026-01-01') // Por defecto desde 1 de enero de 2026
    const dateTo = body.dateTo
      ? new Date(body.dateTo)
      : new Date()

    const user = {
      id: session.user!.id,
      name: session.user!.name || '',
      email: session.user!.email || '',
    }

    syncStatus = { running: true, startedAt: Date.now(), result: null, error: null }

    // Disparar sync en background (sin await)
    syncColppyFacturas(dateFrom, dateTo)
      .then((resumen) => {
        syncStatus = { running: false, startedAt: null, result: resumen, error: null }
        logAudit({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          action: 'SYNC',
          entity: 'INVOICE',
          description: `Sincronizó facturas desde Colppy: ${resumen.created} creadas, ${resumen.updated} actualizadas, ${resumen.skipped} omitidas (${resumen.rangoFechas.desde} a ${resumen.rangoFechas.hasta})`,
        })
      })
      .catch((err) => {
        logger.error('Error en sync Colppy facturas:', err)
        syncStatus = {
          running: false,
          startedAt: null,
          result: null,
          error: err instanceof Error ? err.message : 'Error al sincronizar desde Colppy',
        }
      })

    return NextResponse.json({
      status: 'syncing',
      message: 'Sincronización iniciada en background',
    })
  } catch (error) {
    logger.error('Error en sync Colppy:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al sincronizar desde Colppy' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/facturacion/sync-colppy
 * Devuelve el estado actual del sync (para polling desde la UI).
 */
export async function GET() {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  if (syncStatus.running) {
    return NextResponse.json({
      status: 'running',
      startedAt: syncStatus.startedAt,
      elapsedMs: Date.now() - (syncStatus.startedAt || Date.now()),
    })
  }

  if (syncStatus.error) {
    return NextResponse.json({ status: 'error', error: syncStatus.error })
  }

  if (syncStatus.result) {
    return NextResponse.json({ status: 'done', resumen: syncStatus.result })
  }

  return NextResponse.json({ status: 'idle' })
}

/**
 * POST /api/facturacion/sync-colppy
 * Sincroniza facturas desde Colppy a la base de datos local.
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
import { syncColppyFacturas } from '@/lib/facturacion/sync-colppy'

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const dateFrom = body.dateFrom
      ? new Date(body.dateFrom)
      : new Date('2026-01-01') // Por defecto desde 1 de enero de 2026
    const dateTo = body.dateTo
      ? new Date(body.dateTo)
      : new Date()

    const resumen = await syncColppyFacturas(dateFrom, dateTo)

    logAudit({
      userId: session.user!.id,
      userName: session.user!.name || '',
      userEmail: session.user!.email || '',
      action: 'SYNC',
      entity: 'INVOICE',
      description: `Sincronizó facturas desde Colppy: ${resumen.created} creadas, ${resumen.updated} actualizadas, ${resumen.skipped} omitidas (${resumen.rangoFechas.desde} a ${resumen.rangoFechas.hasta})`,
    })

    return NextResponse.json({ success: true, resumen })
  } catch (error) {
    logger.error('Error en sync Colppy:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al sincronizar desde Colppy' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/mercadolibre/preguntas/sync
 *   Trae las preguntas sin responder de la cuenta de ML y genera borradores
 *   para las que no estén en el ERP (backfill / arranque / notificaciones
 *   perdidas).
 */

import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { syncUnansweredQuestions } from '@/lib/mercadolibre/handleQuestion'

export const maxDuration = 300

export async function POST() {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const result = await syncUnansweredQuestions()
    return NextResponse.json(result)
  } catch (error) {
    logger.error('[ML Preguntas] Error en sync', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al sincronizar' },
      { status: 500 }
    )
  }
}

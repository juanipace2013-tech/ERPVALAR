/**
 * POST /api/mercadolibre/publicaciones/import
 *   Trae todas las publicaciones de ML y las matchea con productos del ERP.
 */

import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { importListings } from '@/lib/mercadolibre/listings'

export const maxDuration = 300

export async function POST() {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    return NextResponse.json(await importListings())
  } catch (error) {
    logger.error('[ML Listings] Error importando publicaciones', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al importar' },
      { status: 500 }
    )
  }
}

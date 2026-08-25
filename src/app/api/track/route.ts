/**
 * POST /api/track — beacon de actividad del dashboard.
 *
 * Lo llama ActivityTracker (montado en el layout del dashboard) en dos casos:
 *   { type: "nav", path }       — cambio de página: guarda UserActivity y
 *                                 actualiza la presencia del usuario.
 *   { type: "heartbeat", path } — cada 2 min con la pestaña visible: solo
 *                                 actualiza lastSeenAt/lastPath (sin historial).
 *
 * Diseñado para carga mínima: un insert/update por evento, sin lecturas
 * (el dedupe de navegaciones repetidas lo hace el cliente), y siempre 204
 * aunque falle (el tracking nunca debe molestar al usuario).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

const MAX_PATH_LEN = 200

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return new NextResponse(null, { status: 204 })

    let body: { type?: string; path?: string }
    try {
      body = await req.json()
    } catch {
      return new NextResponse(null, { status: 204 })
    }

    const path = (body.path ?? '').slice(0, MAX_PATH_LEN)
    // Solo rutas internas del dashboard.
    if (!path.startsWith('/')) return new NextResponse(null, { status: 204 })

    const now = new Date()

    if (body.type === 'nav') {
      const userName = session.user.name ?? session.user.email ?? 'desconocido'
      await prisma.$transaction([
        prisma.userActivity.create({ data: { userId, userName, path } }),
        prisma.user.update({
          where: { id: userId },
          data: { lastSeenAt: now, lastPath: path },
        }),
      ])
    } else {
      // heartbeat
      await prisma.user.update({
        where: { id: userId },
        data: { lastSeenAt: now, lastPath: path },
      })
    }
  } catch (error) {
    logger.error('[Track] Error registrando actividad', error)
  }
  return new NextResponse(null, { status: 204 })
}

/**
 * GET /api/admin/activity — datos de la pestaña "Actividad" de /admin/auditoria.
 *
 * Devuelve en una sola respuesta:
 *   - online:  usuarios con lastSeenAt en los últimos 5 min (y su última página)
 *   - feed:    vistas de página paginadas (filtros userId / date)
 *   - summary: para la fecha filtrada (default hoy), por usuario: total de
 *              vistas, primera/última actividad y páginas más visitadas
 *
 * Mismo control de acceso que /api/admin/audit. Como mantenimiento, purga
 * fire-and-forget el historial de más de 60 días.
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

const ALLOWED_EMAILS = ['stejedor@val-ar.com.ar', 'jpace@val-ar.com.ar']
const ONLINE_WINDOW_MS = 5 * 60 * 1000
const RETENTION_DAYS = 60

/** Rango [00:00, 24:00) hora argentina para una fecha YYYY-MM-DD. */
function argDayRange(dateStr: string): { gte: Date; lt: Date } {
  // Argentina es UTC-3 fijo (sin DST).
  const gte = new Date(`${dateStr}T00:00:00-03:00`)
  const lt = new Date(gte.getTime() + 24 * 60 * 60 * 1000)
  return { gte, lt }
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
    if (!ALLOWED_EMAILS.includes(session.user.email || '')) {
      return NextResponse.json({ error: 'Acceso restringido' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const pageSize = 50
    const userId = searchParams.get('userId')
    const date = searchParams.get('date') // YYYY-MM-DD (hora AR)

    const where: Record<string, unknown> = {}
    if (userId && userId !== 'ALL') where.userId = userId
    if (date) where.createdAt = argDayRange(date)

    const [online, feed, total] = await Promise.all([
      prisma.user.findMany({
        where: { lastSeenAt: { gte: new Date(Date.now() - ONLINE_WINDOW_MS) } },
        select: { id: true, name: true, lastSeenAt: true, lastPath: true },
        orderBy: { lastSeenAt: 'desc' },
      }),
      prisma.userActivity.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.userActivity.count({ where }),
    ])

    // Resumen del día (para la fecha filtrada o hoy).
    const summaryDate =
      date ??
      new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    const dayRange = argDayRange(summaryDate)
    const dayRows = await prisma.userActivity.findMany({
      where: { createdAt: dayRange, ...(userId && userId !== 'ALL' ? { userId } : {}) },
      select: { userId: true, userName: true, path: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    const byUser = new Map<
      string,
      { userName: string; views: number; first: Date; last: Date; pages: Map<string, number> }
    >()
    for (const r of dayRows) {
      let u = byUser.get(r.userId)
      if (!u) {
        u = { userName: r.userName, views: 0, first: r.createdAt, last: r.createdAt, pages: new Map() }
        byUser.set(r.userId, u)
      }
      u.views++
      u.last = r.createdAt
      u.pages.set(r.path, (u.pages.get(r.path) ?? 0) + 1)
    }
    const summary = Array.from(byUser.entries())
      .map(([uid, u]) => ({
        userId: uid,
        userName: u.userName,
        views: u.views,
        first: u.first,
        last: u.last,
        topPages: Array.from(u.pages.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([path, count]) => ({ path, count })),
      }))
      .sort((a, b) => b.views - a.views)

    // Usuarios para el filtro (los que alguna vez registraron actividad).
    const users = await prisma.userActivity.findMany({
      select: { userId: true, userName: true },
      distinct: ['userId'],
      orderBy: { userName: 'asc' },
    })

    // Purga lazy del historial viejo (no bloquea la respuesta).
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    prisma.userActivity
      .deleteMany({ where: { createdAt: { lt: cutoff } } })
      .catch((e) => logger.error('[Activity] Error purgando historial', e))

    return NextResponse.json({
      online,
      feed,
      summary,
      summaryDate,
      users,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    logger.error('Error fetching activity:', error)
    return NextResponse.json({ error: 'Error al obtener actividad' }, { status: 500 })
  }
}

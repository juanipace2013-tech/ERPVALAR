/**
 * GET /api/leads
 *   Lista leads de Google Ads con paginación, búsqueda y filtro por estado.
 *
 *   Query params:
 *     - q:       texto a buscar en fullName / email / phone
 *     - status:  NUEVO | CONTACTADO | COTIZADO | CONVERTIDO | DESCARTADO
 *     - page:    página (default 1)
 *     - pageSize: items por página (default 25, max 100)
 *     - sinceDays: filtra createdAt >= now - N días (para dashboard)
 *     - count:   si está, devuelve solo { total }
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

const VALID_STATUS = new Set([
  'NUEVO',
  'CONTACTADO',
  'COTIZADO',
  'CONVERTIDO',
  'DESCARTADO',
])

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const sp = req.nextUrl.searchParams
  const q = sp.get('q')?.trim() || ''
  const status = sp.get('status')?.trim() || ''
  const sinceDays = parseInt(sp.get('sinceDays') || '')
  const onlyCount = sp.get('count') !== null
  const page = Math.max(1, parseInt(sp.get('page') || '1'))
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') || '25')))

  const where: Prisma.GoogleAdsLeadWhereInput = {}

  if (status && VALID_STATUS.has(status)) {
    where.status = status
  }

  if (Number.isFinite(sinceDays) && sinceDays > 0) {
    const since = new Date()
    since.setDate(since.getDate() - sinceDays)
    where.createdAt = { gte: since }
  }

  if (q) {
    where.OR = [
      { fullName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q, mode: 'insensitive' } },
      { companyName: { contains: q, mode: 'insensitive' } },
    ]
  }

  if (onlyCount) {
    const total = await prisma.googleAdsLead.count({ where })
    return NextResponse.json({ total })
  }

  const [items, total] = await Promise.all([
    prisma.googleAdsLead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { id: true, name: true } },
      },
    }),
    prisma.googleAdsLead.count({ where }),
  ])

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    pageCount: Math.ceil(total / pageSize),
  })
}

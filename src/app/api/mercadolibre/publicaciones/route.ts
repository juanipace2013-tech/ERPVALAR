/**
 * GET /api/mercadolibre/publicaciones?status=UNMATCHED|LINKED|IGNORED|ALL&q=
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { MlLinkStatus, type Prisma } from '@prisma/client'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const status = sp.get('status') ?? 'UNMATCHED'
  const q = (sp.get('q') ?? '').trim()

  const where: Prisma.MlItemLinkWhereInput = {
    ...(status === 'ALL' ? {} : { status: status as MlLinkStatus }),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { mlItemId: { contains: q, mode: 'insensitive' } },
            { product: { sku: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }

  const [items, counts] = await Promise.all([
    prisma.mlItemLink.findMany({
      where,
      orderBy: [{ mlStatus: 'asc' }, { title: 'asc' }],
      include: { product: { select: { id: true, sku: true, name: true, stockQuantity: true } } },
      take: 500,
    }),
    prisma.mlItemLink.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  return NextResponse.json({
    items: items.map((l) => ({
      ...l,
      price: l.price ? Number(l.price) : null,
      lastSyncAt: l.lastSyncAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
  })
}

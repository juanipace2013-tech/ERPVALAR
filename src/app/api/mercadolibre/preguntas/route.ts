/**
 * GET /api/mercadolibre/preguntas?status=PENDING_REVIEW|ANSWERED|...|ALL&page=1
 * Lista de preguntas de ML con su borrador.
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { MlQuestionStatus, type Prisma } from '@prisma/client'
import { serializeQuestion } from '@/lib/mercadolibre/serializeQuestion'

const PAGE_SIZE = 30

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const status = sp.get('status') ?? 'PENDING_REVIEW'
  const page = Math.max(1, Number(sp.get('page') ?? 1))

  const where: Prisma.MlQuestionWhereInput =
    status === 'ALL' ? {} : { status: status as MlQuestionStatus }

  const [items, total, pendingCount] = await Promise.all([
    prisma.mlQuestion.findMany({
      where,
      orderBy: [{ askedAt: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.mlQuestion.count({ where }),
    prisma.mlQuestion.count({ where: { status: MlQuestionStatus.PENDING_REVIEW } }),
  ])

  return NextResponse.json({
    items: items.map(serializeQuestion),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    pendingCount,
    mode: (process.env.ML_QUESTIONS_MODE ?? 'REVIEW').toUpperCase(),
  })
}

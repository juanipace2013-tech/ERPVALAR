/**
 * POST /api/mercadolibre/preguntas/[id]/descartar
 *   Marca la pregunta como DISMISSED (se responde por fuera o no aplica).
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { MlQuestionStatus } from '@prisma/client'
import { serializeQuestion } from '@/lib/mercadolibre/serializeQuestion'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { id } = await params
    const row = await prisma.mlQuestion.findUnique({ where: { id } })
    if (!row) return NextResponse.json({ error: 'Pregunta no encontrada' }, { status: 404 })
    if (row.status === MlQuestionStatus.ANSWERED) {
      return NextResponse.json({ error: 'La pregunta ya fue respondida' }, { status: 409 })
    }

    const updated = await prisma.mlQuestion.update({
      where: { id },
      data: { status: MlQuestionStatus.DISMISSED },
    })
    return NextResponse.json(serializeQuestion(updated))
  } catch (error) {
    logger.error('[ML Preguntas] Error descartando', error)
    return NextResponse.json({ error: 'Error al descartar' }, { status: 500 })
  }
}

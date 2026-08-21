/**
 * POST /api/mercadolibre/preguntas/[id]/regenerar
 *   Vuelve a generar el borrador con la IA (refresca ítem/producto/ejemplos).
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { MlQuestionStatus } from '@prisma/client'
import { draftAnswerFor } from '@/lib/mercadolibre/handleQuestion'
import { serializeQuestion } from '@/lib/mercadolibre/serializeQuestion'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { id } = await params
    const row = await prisma.mlQuestion.findUnique({ where: { id } })
    if (!row) return NextResponse.json({ error: 'Pregunta no encontrada' }, { status: 404 })
    if (row.status !== MlQuestionStatus.PENDING_REVIEW && row.status !== MlQuestionStatus.FAILED) {
      return NextResponse.json(
        { error: `La pregunta no está pendiente (status=${row.status})` },
        { status: 409 }
      )
    }

    const updated = await draftAnswerFor(row)
    return NextResponse.json(serializeQuestion(updated))
  } catch (error) {
    logger.error('[ML Preguntas] Error regenerando borrador', error)
    return NextResponse.json({ error: 'Error al regenerar el borrador' }, { status: 500 })
  }
}

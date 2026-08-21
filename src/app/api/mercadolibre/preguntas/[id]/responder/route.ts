/**
 * POST /api/mercadolibre/preguntas/[id]/responder
 *   Body: { text?: string }  — si no viene, usa el borrador de la IA.
 *   Publica la respuesta en ML. Solo para PENDING_REVIEW o FAILED (reintento).
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { MlQuestionStatus } from '@prisma/client'
import { publishAnswer } from '@/lib/mercadolibre/handleQuestion'
import { serializeQuestion } from '@/lib/mercadolibre/serializeQuestion'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { text?: string }

    const row = await prisma.mlQuestion.findUnique({ where: { id } })
    if (!row) return NextResponse.json({ error: 'Pregunta no encontrada' }, { status: 404 })
    if (row.status !== MlQuestionStatus.PENDING_REVIEW && row.status !== MlQuestionStatus.FAILED) {
      return NextResponse.json(
        { error: `La pregunta no está pendiente (status=${row.status})` },
        { status: 409 }
      )
    }

    const text = (body.text ?? row.draftAnswer ?? '').trim()
    if (!text) return NextResponse.json({ error: 'La respuesta está vacía' }, { status: 400 })

    const updated = await publishAnswer(row, text, session.user.id ?? null)
    return NextResponse.json(serializeQuestion(updated))
  } catch (error) {
    logger.error('[ML Preguntas] Error en responder', error)
    return NextResponse.json({ error: 'Error al responder' }, { status: 500 })
  }
}

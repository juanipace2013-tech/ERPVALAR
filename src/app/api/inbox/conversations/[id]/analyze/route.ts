/**
 * POST /api/inbox/conversations/[id]/analyze
 *
 * Re-análisis manual de una conversación con el agente IA. Disparado desde
 * el botón "Re-analizar" de la UI de bandeja.
 *
 * Body (opcional): { force?: boolean }
 *   - force=true: re-analiza aunque ya haya un análisis para el mismo último
 *     mensaje entrante. Sin force, devuelve 409.
 *
 * Auth requerida. Cualquier rol con acceso a la bandeja puede disparar
 * (ADMIN / GERENTE / VENDEDOR — el resto ni siquiera ve la página).
 *
 * Respuestas:
 *   200 { conversation }              — análisis nuevo OK
 *   409 { error, lastAnalyzedMessageId } — ya analizado, mandá { force: true } para forzar
 *   404 { error }                     — conversación no existe
 *   422 { error }                     — no hay mensaje entrante para analizar
 *   500 { error }                     — fallo del agente (key inválida, timeout, etc.)
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { analyzeConversation } from '@/lib/inbox/ai/analyze'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { force?: boolean }

  // Comprobamos que la conversación exista para devolver 404 limpio
  const exists = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!exists) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })

  try {
    const outcome = await analyzeConversation(id, { force: body.force === true })

    if (outcome.status === 'NO_INBOUND') {
      return NextResponse.json(
        { error: 'La conversación no tiene mensajes entrantes para analizar' },
        { status: 422 }
      )
    }

    if (outcome.status === 'ALREADY_ANALYZED') {
      return NextResponse.json(
        {
          error: 'La conversación ya fue analizada para el último mensaje entrante',
          lastAnalyzedMessageId: outcome.lastAnalyzedMessageId,
          hint: 'Reenviá la request con { "force": true } para re-analizar.',
        },
        { status: 409 }
      )
    }

    // Devolvemos la conversación con los nuevos campos ai*
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        channelAccount: { select: { type: true, name: true, identifier: true } },
        customer: { select: { id: true, name: true, businessName: true } },
        contact: {
          select: { id: true, firstName: true, lastName: true, email: true, phone: true },
        },
        assignedTo: { select: { id: true, name: true } },
        messages: { orderBy: { sentAt: 'asc' } },
      },
    })

    return NextResponse.json({ conversation })
  } catch (e) {
    logger.error(`[POST /api/inbox/conversations/${id}/analyze] Error`, e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error desconocido' },
      { status: 500 }
    )
  }
}

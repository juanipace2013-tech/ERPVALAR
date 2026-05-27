/**
 * GET    /api/inbox/conversations/[id]
 *   Detalle de la conversación con todos los mensajes ordenados ASC.
 *
 * PATCH  /api/inbox/conversations/[id]
 *   Body: { markRead?: boolean, status?, assignedToId? }
 *   Marca como leída (resetea unreadCount), cambia estado o asigna.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { ConversationStatus } from '@prisma/client'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await params
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      channelAccount: { select: { type: true, name: true, identifier: true } },
      customer: { select: { id: true, name: true, businessName: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      assignedTo: { select: { id: true, name: true } },
      messages: { orderBy: { sentAt: 'asc' } },
    },
  })

  if (!conversation) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })
  return NextResponse.json({ conversation })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const data: Record<string, unknown> = {}
  if (body.markRead === true) data.unreadCount = 0
  if (body.status && Object.values(ConversationStatus).includes(body.status)) {
    data.status = body.status
  }
  if (Object.prototype.hasOwnProperty.call(body, 'assignedToId')) {
    data.assignedToId = body.assignedToId || null
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
  }

  const updated = await prisma.conversation.update({ where: { id }, data })
  return NextResponse.json({ conversation: updated })
}

/**
 * GET /api/inbox/conversations
 *
 * Lista paginada de conversaciones de la bandeja.
 * Query params:
 *   channel: WHATSAPP | EMAIL
 *   status:  OPEN | PENDING | CLOSED
 *   unread:  "1" para solo no leídas
 *   assigned: "me" | "unassigned" | userId
 *   q:       búsqueda por contactName / contactIdentifier / subject
 *   limit:   default 50
 *   cursor:  id de la última conversación para paginar
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { ChannelType, ConversationStatus, Prisma } from '@prisma/client'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const url = new URL(req.url)
  const channel = url.searchParams.get('channel') as ChannelType | null
  const status = url.searchParams.get('status') as ConversationStatus | null
  const unread = url.searchParams.get('unread') === '1'
  const assigned = url.searchParams.get('assigned')
  const q = url.searchParams.get('q')?.trim() ?? ''
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100)
  const cursor = url.searchParams.get('cursor')

  const where: Prisma.ConversationWhereInput = {}
  if (channel) where.channelAccount = { type: channel }
  if (status) where.status = status
  if (unread) where.unreadCount = { gt: 0 }
  if (assigned === 'me') where.assignedToId = session.user.id
  else if (assigned === 'unassigned') where.assignedToId = null
  else if (assigned) where.assignedToId = assigned

  if (q) {
    where.OR = [
      { contactName: { contains: q, mode: 'insensitive' } },
      { contactIdentifier: { contains: q, mode: 'insensitive' } },
      { subject: { contains: q, mode: 'insensitive' } },
    ]
  }

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: {
      channelAccount: { select: { type: true, name: true } },
      customer: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
      assignedTo: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
    },
  })

  return NextResponse.json({
    conversations,
    nextCursor: conversations.length === limit ? conversations[conversations.length - 1].id : null,
  })
}

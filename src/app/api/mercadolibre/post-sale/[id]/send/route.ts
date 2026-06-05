/**
 * Envío manual de un mensaje post-venta en modo REVIEW.
 *
 * POST /api/mercadolibre/post-sale/[id]/send
 *   Toma un MlPostSaleMessage en estado PENDING_REVIEW y ejecuta el envío
 *   (misma lógica que el modo AUTO del handler). Actualiza el status según el
 *   resultado (SENT / MODERATED / FAILED).
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { MlPostSaleStatus } from '@prisma/client'
import { sendPostSaleMessage } from '@/lib/mercadolibre/handlePostSale'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params

    const message = await prisma.mlPostSaleMessage.findUnique({ where: { id } })
    if (!message) {
      return NextResponse.json({ error: 'Mensaje no encontrado' }, { status: 404 })
    }

    if (message.status !== MlPostSaleStatus.PENDING_REVIEW) {
      return NextResponse.json(
        {
          error: `El mensaje no está pendiente de revisión (status=${message.status})`,
        },
        { status: 409 }
      )
    }

    const updated = await sendPostSaleMessage(message)

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      mlMessageId: updated.mlMessageId,
      moderationReason: updated.moderationReason,
      sentAt: updated.sentAt,
    })
  } catch (error) {
    logger.error('[ML PostSale] Error en envío manual', error)
    return NextResponse.json({ error: 'Error al enviar el mensaje' }, { status: 500 })
  }
}

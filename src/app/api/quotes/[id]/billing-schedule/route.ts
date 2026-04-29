import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

/**
 * PATCH /api/quotes/[id]/billing-schedule
 *
 * Programa (o limpia) la fecha objetivo de facturación y la nota asociada.
 * Solo informativo: NO bloquea la facturación manual.
 *
 * Body: { billingTargetDate?: string | null, billingNote?: string | null }
 *   - Pasar `null` en cualquiera de los dos limpia ese campo.
 *   - Omitir un campo lo deja sin tocar.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params
    const body = (await request.json()) as {
      billingTargetDate?: string | null
      billingNote?: string | null
    }

    const data: {
      billingTargetDate?: Date | null
      billingNote?: string | null
      billingNoteUpdatedAt: Date
      billingNoteUpdatedBy: string
    } = {
      billingNoteUpdatedAt: new Date(),
      billingNoteUpdatedBy: session.user.id ?? '',
    }

    if ('billingTargetDate' in body) {
      if (body.billingTargetDate === null || body.billingTargetDate === '') {
        data.billingTargetDate = null
      } else {
        const parsed = new Date(body.billingTargetDate as string)
        if (isNaN(parsed.getTime())) {
          return NextResponse.json(
            { error: 'Fecha inválida' },
            { status: 400 }
          )
        }
        data.billingTargetDate = parsed
      }
    }

    if ('billingNote' in body) {
      if (body.billingNote === null || body.billingNote === '') {
        data.billingNote = null
      } else {
        const trimmed = String(body.billingNote).trim()
        if (trimmed.length > 500) {
          return NextResponse.json(
            { error: 'La nota no puede superar 500 caracteres' },
            { status: 400 }
          )
        }
        data.billingNote = trimmed
      }
    }

    const existing = await prisma.quote.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })
    }

    const updated = await prisma.quote.update({
      where: { id },
      data,
      select: {
        id: true,
        billingTargetDate: true,
        billingNote: true,
        billingNoteUpdatedAt: true,
        billingNoteUpdatedBy: true,
      },
    })

    return NextResponse.json({ success: true, quote: updated })
  } catch (error: unknown) {
    logger.error('Error updating billing schedule:', error)
    const message = error instanceof Error ? error.message : 'Error al actualizar programación de facturación'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

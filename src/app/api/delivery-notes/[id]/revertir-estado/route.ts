import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { headers } from 'next/headers'
import { DeliveryNoteStatus } from '@prisma/client'

const revertirEstadoSchema = z.object({
  motivo: z.string().trim().min(10).max(500),
})

// Mapa de transiciones inversas permitidas. El estado destino se calcula
// server-side para evitar que cliente y server se desincronicen.
// PENDING no tiene predecesor; CANCELLED es un flujo aparte (anulación).
const REVERSAL_MAP: Partial<Record<DeliveryNoteStatus, DeliveryNoteStatus>> = {
  PREPARING: 'PENDING',
  READY: 'PREPARING',
  DISPATCHED: 'READY',
  DELIVERED: 'DISPATCHED',
}

async function getClientIp(): Promise<string | null> {
  try {
    const hdrs = await headers()
    return (
      hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      hdrs.get('x-real-ip') ||
      null
    )
  } catch {
    return null
  }
}

/**
 * POST /api/delivery-notes/[id]/revertir-estado
 *
 * Revierte un remito al estado inmediato anterior según REVERSAL_MAP.
 * Cualquier usuario autenticado puede revertir; el motivo es obligatorio
 * y queda registrado en AuditLog (en la misma transacción que el update
 * para garantizar que no se pierda).
 *
 * Reglas de limpieza de campos:
 *  - DELIVERED → DISPATCHED: limpia deliveryDate y receivedBy (campos
 *    que se setean al marcar Entregado).
 *  - Resto de transiciones: solo cambia status. El modelo DeliveryNote
 *    no tiene timestamps por estado (verificado en schema.prisma) así
 *    que no hay nada más que revertir.
 *
 * NO toca stock (control va por Colppy aparte), NO toca Colppy,
 * NO toca facturas asociadas. NO toca internalNotes.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()

    let parsed: z.infer<typeof revertirEstadoSchema>
    try {
      parsed = revertirEstadoSchema.parse(body)
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Datos inválidos', details: err.issues },
          { status: 400 }
        )
      }
      throw err
    }

    const current = await prisma.deliveryNote.findUnique({
      where: { id },
      select: { id: true, status: true, deliveryNumber: true },
    })

    if (!current) {
      return NextResponse.json({ error: 'Remito no encontrado' }, { status: 404 })
    }

    const targetStatus = REVERSAL_MAP[current.status]
    if (!targetStatus) {
      const reason =
        current.status === 'PENDING'
          ? 'el estado Pendiente no tiene un estado anterior al cual revertir'
          : current.status === 'CANCELLED'
          ? 'un remito anulado no se puede revertir (use el flujo de anulación)'
          : `el estado ${current.status} no admite reversión`
      return NextResponse.json(
        { error: `No se puede revertir: ${reason}.` },
        { status: 400 }
      )
    }

    // Limpieza condicional de campos según la transición concreta.
    // Solo DELIVERED → DISPATCHED necesita limpiar deliveryDate/receivedBy
    // (se setean al marcar Entregado). El resto solo cambia status.
    const updateData: {
      status: DeliveryNoteStatus
      deliveryDate?: null
      receivedBy?: null
    } = { status: targetStatus }
    if (current.status === 'DELIVERED' && targetStatus === 'DISPATCHED') {
      updateData.deliveryDate = null
      updateData.receivedBy = null
    }

    const ip = await getClientIp()

    // Transacción atómica update + audit log: apartamos del patrón
    // fire-and-forget de logAudit() porque el motivo no puede perderse.
    const [updated] = await prisma.$transaction([
      prisma.deliveryNote.update({
        where: { id },
        data: updateData,
        include: {
          items: { include: { product: true } },
          customer: true,
          supplier: true,
          quote: true,
          invoices: true,
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: session.user.id ?? '',
          userName: session.user.name ?? '',
          userEmail: session.user.email ?? '',
          action: 'STATUS_CHANGE',
          entity: 'DELIVERY_NOTE',
          entityId: id,
          entityRef: current.deliveryNumber,
          description: `Reversión de estado del remito ${current.deliveryNumber}. Estado: ${current.status} → ${targetStatus}. Motivo: ${parsed.motivo}`,
          ip,
        },
      }),
    ])

    return NextResponse.json(updated)
  } catch (error) {
    logger.error('Error reverting delivery note status:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al revertir estado' },
      { status: 500 }
    )
  }
}

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { headers } from 'next/headers'

const revertirEntregaSchema = z.object({
  motivo: z.string().trim().min(10).max(500),
})

// Estado destino al revertir una entrega. Como el modelo DeliveryNote no
// guarda timestamps individuales por estado (no hay dispatchedAt/readyAt),
// no podemos saber si la card vino por el flujo normal (DISPATCHED → DELIVERED)
// o por el atajo (READY → DELIVERED), así que revertimos siempre al estado
// más común y semánticamente correcto: DISPATCHED (el remito salió pero
// no fue entregado). Si el usuario lo quería en READY, lo ajusta manualmente.
const TARGET_STATUS = 'DISPATCHED' as const

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
 * POST /api/delivery-notes/[id]/revertir-entrega
 *
 * Revierte un remito en estado DELIVERED al estado DISPATCHED (caso
 * "marqué entregado por error"). Limpia deliveryDate y receivedBy.
 * NO toca stock, NO toca Colppy, NO toca facturas asociadas: si hay
 * factura, el usuario verá la inconsistencia y decidirá qué hacer.
 *
 * Cualquier usuario autenticado puede revertir. El motivo y la transición
 * quedan registrados en AuditLog (en la misma transacción que el update,
 * para garantizar que el motivo no se pierda).
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

    let parsed: z.infer<typeof revertirEntregaSchema>
    try {
      parsed = revertirEntregaSchema.parse(body)
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Datos inválidos', details: err.issues },
          { status: 400 }
        )
      }
      throw err
    }

    // Validar estado actual antes de la transacción
    const current = await prisma.deliveryNote.findUnique({
      where: { id },
      select: { id: true, status: true, deliveryNumber: true },
    })

    if (!current) {
      return NextResponse.json({ error: 'Remito no encontrado' }, { status: 404 })
    }

    if (current.status !== 'DELIVERED') {
      return NextResponse.json(
        {
          error: `Solo se puede revertir un remito en estado Entregado. Estado actual: ${current.status}`,
        },
        { status: 400 }
      )
    }

    const ip = await getClientIp()

    // Transacción: update + audit log atómicos. Apartamos del patrón
    // fire-and-forget de logAudit() porque el motivo no puede perderse.
    const [updated] = await prisma.$transaction([
      prisma.deliveryNote.update({
        where: { id },
        data: {
          status: TARGET_STATUS,
          deliveryDate: null,
          receivedBy: null,
        },
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
          description: `Reversión de entrega del remito ${current.deliveryNumber}. Estado: DELIVERED → ${TARGET_STATUS}. Motivo: ${parsed.motivo}`,
          ip,
        },
      }),
    ])

    return NextResponse.json(updated)
  } catch (error) {
    logger.error('Error reverting delivery note status:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al revertir entrega' },
      { status: 500 }
    )
  }
}

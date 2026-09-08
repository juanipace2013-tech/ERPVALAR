/**
 * POST /api/mercadolibre/alertas-envio/[id]/resolver
 *   Marca la alerta de envío bloqueado como RESOLVED (la venta ya se anuló o
 *   se gestionó por fuera). Saca el cartel rojo del layout.
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { MlShippingAlertStatus } from '@prisma/client'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { id } = await params
    const row = await prisma.mlShippingAlert.findUnique({ where: { id } })
    if (!row) return NextResponse.json({ error: 'Alerta no encontrada' }, { status: 404 })

    const updated = await prisma.mlShippingAlert.update({
      where: { id },
      data: { status: MlShippingAlertStatus.RESOLVED, resolvedAt: new Date() },
    })
    return NextResponse.json({ id: updated.id, status: updated.status })
  } catch (error) {
    logger.error('[ML Envíos] Error resolviendo alerta', error)
    return NextResponse.json({ error: 'Error al resolver la alerta' }, { status: 500 })
  }
}

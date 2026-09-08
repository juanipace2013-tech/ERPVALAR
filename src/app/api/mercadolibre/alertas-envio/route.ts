/**
 * GET /api/mercadolibre/alertas-envio
 *   Alertas PENDING de ventas de ML con envío a provincia bloqueada
 *   (Misiones). Alimenta el cartel rojo del layout (MlShippingAlertBanner).
 *   ?countOnly=true -> { pendingCount } liviano.
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { MlShippingAlertStatus } from '@prisma/client'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  if (req.nextUrl.searchParams.get('countOnly') === 'true') {
    const pendingCount = await prisma.mlShippingAlert.count({
      where: { status: MlShippingAlertStatus.PENDING },
    })
    return NextResponse.json({ pendingCount })
  }

  const items = await prisma.mlShippingAlert.findMany({
    where: { status: MlShippingAlertStatus.PENDING },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ items })
}

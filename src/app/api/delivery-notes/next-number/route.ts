import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import { peekNextDeliveryNumber } from '@/lib/quote-workflow'
import { logger } from '@/lib/logger'

/**
 * GET /api/delivery-notes/next-number
 * Próximo número de remito propuesto (siguiente al último usado del talonario
 * CAI activo), sin consumirlo. El formulario lo muestra pre-cargado y editable.
 */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
    const { next, caiVigente } = await peekNextDeliveryNumber()
    return NextResponse.json({ next, caiVigente })
  } catch (error) {
    logger.error('Error obteniendo próximo número de remito:', error)
    return NextResponse.json({ error: 'Error al calcular el próximo número' }, { status: 500 })
  }
}

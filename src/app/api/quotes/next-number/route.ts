import { logger } from '@/lib/logger'
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { generateNextQuoteNumber } from '@/lib/quotes/generate-quote-number'

/**
 * GET /api/quotes/next-number
 * Obtiene el próximo número de cotización disponible
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const quoteNumber = await prisma.$transaction(async (tx) => {
      return await generateNextQuoteNumber(tx)
    })

    return NextResponse.json({ quoteNumber })
  } catch (error) {
    logger.error('Error getting next quote number:', error)
    return NextResponse.json(
      { error: 'Error al obtener número de cotización' },
      { status: 500 }
    )
  }
}

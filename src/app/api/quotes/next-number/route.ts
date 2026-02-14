import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/quotes/next-number
 * Obtiene el próximo número de cotización disponible
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const year = new Date().getFullYear()

    // Buscar la última cotización del año actual
    const lastQuote = await prisma.quote.findFirst({
      where: {
        quoteNumber: {
          startsWith: `VAL-${year}-`,
        },
      },
      orderBy: {
        quoteNumber: 'desc',
      },
    })

    let nextNumber = 1
    if (lastQuote) {
      const match = lastQuote.quoteNumber.match(/VAL-\d{4}-(\d{3})/)
      if (match) {
        nextNumber = parseInt(match[1]) + 1
      }
    }

    const quoteNumber = `VAL-${year}-${String(nextNumber).padStart(3, '0')}`

    return NextResponse.json({ quoteNumber })
  } catch (error) {
    console.error('Error getting next quote number:', error)
    return NextResponse.json(
      { error: 'Error al obtener número de cotización' },
      { status: 500 }
    )
  }
}

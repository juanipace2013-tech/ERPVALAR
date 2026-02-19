import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'


import { prisma } from '@/lib/prisma'

/**
 * GET /api/brands/discounts
 * Obtiene todos los descuentos por marca
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const discounts = await prisma.brandDiscount.findMany({
      orderBy: {
        brand: 'asc',
      },
    })

    return NextResponse.json({ discounts })
  } catch (error) {
    console.error('Error fetching brand discounts:', error)
    return NextResponse.json(
      { error: 'Error al obtener descuentos de marca' },
      { status: 500 }
    )
  }
}

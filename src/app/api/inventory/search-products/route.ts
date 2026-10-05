import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').trim()

    if (q.length < 2) {
      return NextResponse.json({ products: [] })
    }

    const products = await prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { sku: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        sku: true,
        name: true,
        brand: true,
        supplier: { select: { name: true } },
        // Factura directa: IVA del producto (solo 21%) y precio de venta sugerido (solo SALE: sin costos)
        taxRate: true,
        prices: {
          where: { priceType: 'SALE' },
          select: { priceType: true, currency: true, amount: true, validFrom: true, validUntil: true },
          orderBy: { validFrom: 'desc' },
          take: 10,
        },
      },
      take: 10,
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ products })
  } catch (error: unknown) {
    logger.error('Error searching products:', error)
    const message = error instanceof Error ? error.message : 'Error al buscar productos'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

import { auth } from '@/auth'
import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

// GET /api/productos/marcas - Marcas distintas para el filtro del listado
export async function GET() {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const rows = await prisma.product.findMany({
      where: { brand: { not: null } },
      distinct: ['brand'],
      select: { brand: true },
      orderBy: { brand: 'asc' },
    })
    // distinct de Prisma es case-sensitive; acá se dedup-ea sin distinguir mayúsculas
    const seen = new Set<string>()
    const brands: string[] = []
    for (const r of rows) {
      const b = r.brand?.trim()
      if (!b) continue
      const key = b.toUpperCase()
      if (seen.has(key)) continue
      seen.add(key)
      brands.push(b)
    }

    return NextResponse.json({ brands })
  } catch (error) {
    logger.error('Error fetching brands:', error)
    return NextResponse.json({ error: 'Error al obtener marcas' }, { status: 500 })
  }
}

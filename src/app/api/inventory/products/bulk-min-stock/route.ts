import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    if (!['ADMIN', 'GERENTE'].includes(session.user.role)) {
      return NextResponse.json({ error: 'No tienes permisos' }, { status: 403 })
    }

    const body = await request.json()
    const { productIds, supplierId, minStock } = body

    if (minStock === undefined || minStock < 0) {
      return NextResponse.json({ error: 'minStock debe ser >= 0' }, { status: 400 })
    }

    const minStockValue = Math.max(0, parseInt(minStock))

    if (productIds && Array.isArray(productIds) && productIds.length > 0) {
      const result = await prisma.product.updateMany({
        where: { id: { in: productIds } },
        data: { minStock: minStockValue },
      })
      return NextResponse.json({ success: true, updated: result.count })
    }

    if (supplierId) {
      const result = await prisma.product.updateMany({
        where: { supplierId },
        data: { minStock: minStockValue },
      })
      return NextResponse.json({ success: true, updated: result.count })
    }

    return NextResponse.json(
      { error: 'Debe proporcionar productIds o supplierId' },
      { status: 400 }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error al actualizar'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

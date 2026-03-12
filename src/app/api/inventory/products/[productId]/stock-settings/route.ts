import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { productId } = await params
    const body = await request.json()
    const { minStock, maxStock } = body

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    })

    if (!product) {
      return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 })
    }

    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        ...(minStock !== undefined ? { minStock: Math.max(0, parseInt(minStock)) } : {}),
        ...(maxStock !== undefined ? { maxStock: maxStock ? parseInt(maxStock) : null } : {}),
      },
      select: { id: true, sku: true, name: true, minStock: true, maxStock: true },
    })

    return NextResponse.json({ success: true, product: updated })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error al actualizar'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

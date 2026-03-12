import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const { links } = body

    if (!Array.isArray(links) || links.length === 0) {
      return NextResponse.json({ error: 'Debe proporcionar links' }, { status: 400 })
    }

    let linked = 0

    await prisma.$transaction(async (tx) => {
      for (const link of links) {
        const { purchaseInvoiceItemId, productId } = link

        if (!purchaseInvoiceItemId || !productId) continue

        // Verify product exists
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { id: true },
        })

        if (!product) continue

        // Verify item exists
        const item = await tx.purchaseInvoiceItem.findUnique({
          where: { id: purchaseInvoiceItemId },
          select: { id: true },
        })

        if (!item) continue

        await tx.purchaseInvoiceItem.update({
          where: { id: purchaseInvoiceItemId },
          data: { productId },
        })

        linked++
      }
    })

    return NextResponse.json({ success: true, linked })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error al vincular'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

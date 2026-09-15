import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

/**
 * Vincula (o desvincula, con productId null) items de facturas de compra a
 * productos del catálogo. Un item cuyo stock ya se impactó no se toca: habría
 * que reversar el stock primero.
 */
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
    let unlinked = 0
    const skipped: string[] = []

    await prisma.$transaction(async (tx) => {
      for (const link of links) {
        const { purchaseInvoiceItemId, productId } = link

        if (!purchaseInvoiceItemId) continue

        const item = await tx.purchaseInvoiceItem.findUnique({
          where: { id: purchaseInvoiceItemId },
          select: { id: true, stockProcessed: true },
        })
        if (!item) continue

        if (item.stockProcessed) {
          skipped.push(purchaseInvoiceItemId)
          continue
        }

        if (productId === null) {
          await tx.purchaseInvoiceItem.update({
            where: { id: purchaseInvoiceItemId },
            data: { productId: null },
          })
          unlinked++
          continue
        }

        if (!productId) continue

        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { id: true },
        })
        if (!product) continue

        await tx.purchaseInvoiceItem.update({
          where: { id: purchaseInvoiceItemId },
          data: { productId },
        })

        linked++
      }
    }, { maxWait: 10000, timeout: 30000 })

    if (linked === 0 && unlinked === 0 && skipped.length > 0) {
      return NextResponse.json(
        { error: 'El stock de este item ya fue impactado; reversá el stock antes de cambiar el producto' },
        { status: 409 }
      )
    }

    return NextResponse.json({ success: true, linked, unlinked, skipped })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error al vincular'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

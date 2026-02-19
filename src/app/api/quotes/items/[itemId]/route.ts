import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'


import { prisma } from '@/lib/prisma'

/**
 * DELETE /api/quotes/items/[itemId]
 * Eliminar item de cotización
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { itemId } = await params

    const item = await prisma.quoteItem.findUnique({
      where: { id: itemId },
    })

    if (!item) {
      return NextResponse.json({ error: 'Item no encontrado' }, { status: 404 })
    }

    const quoteId = item.quoteId

    // Eliminar item (cascade eliminará additionals automáticamente)
    await prisma.quoteItem.delete({
      where: { id: itemId },
    })

    // Recalcular totales
    await recalculateQuoteTotals(quoteId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting item:', error)
    return NextResponse.json(
      { error: 'Error al eliminar item' },
      { status: 500 }
    )
  }
}

/**
 * Recalcula los totales de la cotización
 */
async function recalculateQuoteTotals(quoteId: string) {
  const items = await prisma.quoteItem.findMany({
    where: {
      quoteId,
      isAlternative: false,
    },
  })

  const total = items.reduce((sum, item) => sum + Number(item.totalPrice), 0)

  await prisma.quote.update({
    where: { id: quoteId },
    data: {
      subtotal: total,
      total: total,
    },
  })
}

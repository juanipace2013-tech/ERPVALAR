import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { processPurchaseInvoiceStock } from '@/lib/inventario/purchase-stock.service'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    if (!['ADMIN', 'GERENTE'].includes(session.user.role)) {
      return NextResponse.json(
        { error: 'No tienes permisos para impactar stock' },
        { status: 403 }
      )
    }

    const { invoiceId } = await params

    const result = await processPurchaseInvoiceStock(invoiceId, session.user.id)

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error al procesar stock'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

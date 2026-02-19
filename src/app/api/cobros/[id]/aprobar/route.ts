import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { approveReceipt } from '@/lib/cobros/receipt.service'

// POST /api/cobros/[id]/aprobar
// Aprueba un recibo BORRADOR y genera el asiento contable tipo REC
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Solo ADMIN y CONTADOR pueden aprobar recibos
    if (!['ADMIN', 'CONTADOR'].includes(session.user.role)) {
      return NextResponse.json(
        { error: 'Solo ADMIN o CONTADOR pueden aprobar recibos' },
        { status: 403 }
      )
    }

    const result = await approveReceipt(params.id, session.user.id)

    return NextResponse.json({
      success:      true,
      receiptId:    result.receiptId,
      journalEntry: {
        id:          result.journalEntryId,
        entryNumber: result.entryNumber,
      },
      message: `Recibo aprobado. Asiento contable #${result.entryNumber} generado.`
    })
  } catch (error: any) {
    console.error('[POST /api/cobros/[id]/aprobar]', error)
    if (error?.message) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const session = await auth()

    if (!session) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { status } = body

    // Validar estado
    if (!['PENDING', 'CLEARED', 'REJECTED', 'CANCELLED'].includes(status)) {
      return NextResponse.json(
        { error: 'Estado no válido' },
        { status: 400 }
      )
    }

    // Obtener la transacción
    const transaction = await prisma.bankTransaction.findUnique({
      where: { id: id },
    })

    if (!transaction) {
      return NextResponse.json(
        { error: 'Cheque no encontrado' },
        { status: 404 }
      )
    }

    // Actualizar descripción para indicar el nuevo estado
    let updatedDescription = transaction.description || ''

    if (status === 'CLEARED') {
      updatedDescription = `${transaction.description || 'Cheque'} - COBRADO`
    } else if (status === 'REJECTED') {
      updatedDescription = `${transaction.description || 'Cheque'} - RECHAZADO`
    } else if (status === 'CANCELLED') {
      updatedDescription = `${transaction.description || 'Cheque'} - ANULADO`
    }

    // Actualizar transacción
    const updated = await prisma.bankTransaction.update({
      where: { id: id },
      data: {
        description: updatedDescription,
      },
    })

    return NextResponse.json({
      success: true,
      transaction: {
        ...updated,
        debit: parseFloat(updated.debit.toString()),
        credit: parseFloat(updated.credit.toString()),
        balance: parseFloat(updated.balance.toString()),
        date: updated.date.toISOString(),
      },
    })
  } catch (error) {
    console.error('Error updating check status:', error)
    return NextResponse.json(
      { error: 'Error al actualizar estado del cheque' },
      { status: 500 }
    )
  }
}

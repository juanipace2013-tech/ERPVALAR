import { logger } from '@/lib/logger'
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { transactionIds, bankStatementBalance } = body

    // Validaciones
    if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
      return NextResponse.json(
        { error: 'Debe proporcionar IDs de transacciones' },
        { status: 400 }
      )
    }

    // Marcar transacciones como conciliadas
    // Por ahora, agregamos [CONCILIADO] a la descripción
    // En el futuro se puede agregar un campo "reconciled" y "reconciledAt" a BankTransaction
    const result = await prisma.$transaction(async (tx) => {
      const updated = []

      for (const id of transactionIds) {
        const transaction = await tx.bankTransaction.findUnique({
          where: { id },
        })

        if (transaction) {
          const updatedTx = await tx.bankTransaction.update({
            where: { id },
            data: {
              description: transaction.description
                ? `${transaction.description} [CONCILIADO]`
                : '[CONCILIADO]',
            },
          })
          updated.push(updatedTx)
        }
      }

      return updated
    }, { maxWait: 10000, timeout: 30000 })

    return NextResponse.json({
      success: true,
      reconciledCount: result.length,
      bankStatementBalance,
    })
  } catch (error) {
    logger.error('Error reconciling transactions:', error)
    return NextResponse.json(
      { error: 'Error al conciliar transacciones' },
      { status: 500 }
    )
  }
}

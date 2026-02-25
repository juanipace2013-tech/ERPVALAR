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
    const {
      customerId,
      bankAccountId,
      amount,
      collectionMethod,
      description,
      checkNumber,
      date,
    } = body

    // Validaciones
    if (!customerId || !bankAccountId || !amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Datos inválidos' },
        { status: 400 }
      )
    }

    // Generar número de recibo único
    const lastReceipt = await prisma.receipt.findFirst({
      orderBy: { receiptNumber: 'desc' },
    })

    let nextNumber = 1
    if (lastReceipt && lastReceipt.receiptNumber) {
      const match = lastReceipt.receiptNumber.match(/REC-(\d+)/)
      if (match) {
        nextNumber = parseInt(match[1]) + 1
      }
    }
    const receiptNumber = `REC-${nextNumber.toString().padStart(8, '0')}`

    // Obtener cuenta bancaria para el saldo
    const bankAccount = await prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
    })

    if (!bankAccount) {
      return NextResponse.json(
        { error: 'Cuenta bancaria no encontrada' },
        { status: 404 }
      )
    }

    // Obtener último movimiento para calcular saldo
    const lastTransaction = await prisma.bankTransaction.findFirst({
      where: { bankAccountId },
      orderBy: { date: 'desc' },
    })

    const currentBalance = lastTransaction
      ? parseFloat(lastTransaction.balance.toString())
      : parseFloat(bankAccount.balance.toString())

    const newBalance = currentBalance + amount

    // Crear todo en una transacción
    const result = await prisma.$transaction(async (tx) => {
      // 1. Crear el recibo
      const receipt = await tx.receipt.create({
        data: {
          receiptNumber,
          date: new Date(date),
          customerId,
          bankAccountId,
          collectionMethod,
          amount,
          currency: 'ARS',
          description,
          checkNumber,
          status: 'COMPLETED',
        },
      })

      // 2. Crear el movimiento bancario
      const transaction = await tx.bankTransaction.create({
        data: {
          bankAccountId,
          date: new Date(date),
          type: 'INCOME',
          entityName: null, // Se puede agregar nombre del cliente
          voucherType: 'REC',
          voucherNumber: receiptNumber,
          checkNumber,
          description: description || `Cobranza de cliente`,
          debit: amount,
          credit: 0,
          balance: newBalance,
        },
      })

      // 3. Actualizar saldo de la cuenta bancaria
      await tx.bankAccount.update({
        where: { id: bankAccountId },
        data: {
          balance: newBalance,
        },
      })

      // 4. Actualizar saldo del cliente (reducir saldo a favor)
      await tx.customer.update({
        where: { id: customerId },
        data: {
          balance: {
            decrement: amount,
          },
        },
      })

      return { receipt, transaction }
    })

    return NextResponse.json({
      success: true,
      receipt: {
        ...result.receipt,
        amount: parseFloat(result.receipt.amount.toString()),
        date: result.receipt.date.toISOString(),
      },
    })
  } catch (error) {
    console.error('Error creating receipt:', error)
    return NextResponse.json(
      { error: 'Error al registrar la cobranza' },
      { status: 500 }
    )
  }
}

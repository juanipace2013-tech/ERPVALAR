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
      supplierId,
      bankAccountId,
      amount,
      paymentMethod,
      description,
      checkNumber,
      date,
    } = body

    // Validaciones
    if (!supplierId || !bankAccountId || !amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Datos inválidos' },
        { status: 400 }
      )
    }

    // Generar número de pago único
    const lastPayment = await prisma.payment.findFirst({
      orderBy: { paymentNumber: 'desc' },
    })

    let nextNumber = 1
    if (lastPayment && lastPayment.paymentNumber) {
      const match = lastPayment.paymentNumber.match(/PAG-(\d+)/)
      if (match) {
        nextNumber = parseInt(match[1]) + 1
      }
    }
    const paymentNumber = `PAG-${nextNumber.toString().padStart(8, '0')}`

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

    const newBalance = currentBalance - amount

    // Crear todo en una transacción
    const result = await prisma.$transaction(async (tx) => {
      // 1. Crear el pago
      const payment = await tx.payment.create({
        data: {
          paymentNumber,
          date: new Date(date),
          supplierId,
          bankAccountId,
          paymentMethod,
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
          type: 'EXPENSE',
          entityName: null, // Se puede agregar nombre del proveedor
          voucherType: 'PAG',
          voucherNumber: paymentNumber,
          checkNumber,
          description: description || `Pago a proveedor`,
          debit: 0,
          credit: amount,
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

      // 4. Actualizar saldo del proveedor (reducir deuda)
      await tx.supplier.update({
        where: { id: supplierId },
        data: {
          balance: {
            decrement: amount,
          },
        },
      })

      return { payment, transaction }
    })

    return NextResponse.json({
      success: true,
      payment: {
        ...result.payment,
        amount: parseFloat(result.payment.amount.toString()),
        date: result.payment.date.toISOString(),
      },
    })
  } catch (error) {
    console.error('Error creating payment:', error)
    return NextResponse.json(
      { error: 'Error al registrar el pago' },
      { status: 500 }
    )
  }
}

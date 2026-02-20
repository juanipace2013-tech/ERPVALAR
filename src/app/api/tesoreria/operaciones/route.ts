import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { BankTransactionType } from '@prisma/client'

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
      bankAccountId,
      operationType,
      amount,
      description,
      checkNumber,
      destinationAccountId,
      date,
    } = body

    // Validaciones
    if (!bankAccountId || !operationType || !amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Datos inválidos' },
        { status: 400 }
      )
    }

    if (operationType === 'TRANSFER' && !destinationAccountId) {
      return NextResponse.json(
        { error: 'Debe especificar cuenta destino para transferencias' },
        { status: 400 }
      )
    }

    if (operationType === 'TRANSFER' && destinationAccountId === bankAccountId) {
      return NextResponse.json(
        { error: 'La cuenta destino debe ser diferente a la cuenta origen' },
        { status: 400 }
      )
    }

    // Obtener cuenta bancaria origen
    const sourceAccount = await prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
    })

    if (!sourceAccount) {
      return NextResponse.json(
        { error: 'Cuenta bancaria no encontrada' },
        { status: 404 }
      )
    }

    // Obtener último movimiento de la cuenta origen
    const lastSourceTransaction = await prisma.bankTransaction.findFirst({
      where: { bankAccountId },
      orderBy: { date: 'desc' },
    })

    const currentSourceBalance = lastSourceTransaction
      ? parseFloat(lastSourceTransaction.balance.toString())
      : parseFloat(sourceAccount.balance.toString())

    // Para transferencias, también necesitamos la cuenta destino
    let destinationAccount = null
    let currentDestBalance = 0

    if (operationType === 'TRANSFER' && destinationAccountId) {
      destinationAccount = await prisma.bankAccount.findUnique({
        where: { id: destinationAccountId },
      })

      if (!destinationAccount) {
        return NextResponse.json(
          { error: 'Cuenta destino no encontrada' },
          { status: 404 }
        )
      }

      const lastDestTransaction = await prisma.bankTransaction.findFirst({
        where: { bankAccountId: destinationAccountId },
        orderBy: { date: 'desc' },
      })

      currentDestBalance = lastDestTransaction
        ? parseFloat(lastDestTransaction.balance.toString())
        : parseFloat(destinationAccount.balance.toString())
    }

    // Calcular nuevo saldo según tipo de operación
    let newSourceBalance = currentSourceBalance
    let transactionType: BankTransactionType = BankTransactionType.EXPENSE
    let debit = 0
    let credit = 0
    let voucherType = 'OP'
    let descriptionText = description || ''

    switch (operationType) {
      case 'DEPOSIT':
        newSourceBalance = currentSourceBalance + amount
        transactionType = BankTransactionType.DEPOSIT
        debit = amount
        credit = 0
        voucherType = 'DEP'
        descriptionText = descriptionText || 'Depósito'
        break

      case 'WITHDRAWAL':
        newSourceBalance = currentSourceBalance - amount
        transactionType = BankTransactionType.WITHDRAWAL
        debit = 0
        credit = amount
        voucherType = 'EXT'
        descriptionText = descriptionText || 'Extracción'
        break

      case 'TRANSFER':
        newSourceBalance = currentSourceBalance - amount
        transactionType = BankTransactionType.TRANSFER
        debit = 0
        credit = amount
        voucherType = 'TRF'
        descriptionText = descriptionText || `Transferencia a ${destinationAccount?.name}`
        break

      case 'CHECK_CLEARING':
        newSourceBalance = currentSourceBalance + amount
        transactionType = BankTransactionType.CHECK_CLEARING
        debit = amount
        credit = 0
        voucherType = 'CHQ'
        descriptionText = descriptionText || `Cobro de cheque ${checkNumber}`
        break

      default:
        return NextResponse.json(
          { error: 'Tipo de operación no válido' },
          { status: 400 }
        )
    }

    // Generar número de operación único
    const lastOperation = await prisma.bankTransaction.findFirst({
      where: { voucherType },
      orderBy: { voucherNumber: 'desc' },
    })

    let nextNumber = 1
    if (lastOperation && lastOperation.voucherNumber) {
      const match = lastOperation.voucherNumber.match(/\d+/)
      if (match) {
        nextNumber = parseInt(match[0]) + 1
      }
    }
    const operationNumber = `${voucherType}-${nextNumber.toString().padStart(8, '0')}`

    // Crear transacción(es) en la base de datos
    const result = await prisma.$transaction(async (tx) => {
      // 1. Crear movimiento en cuenta origen
      const sourceTransaction = await tx.bankTransaction.create({
        data: {
          bankAccountId,
          date: new Date(date),
          type: transactionType,
          entityName: null,
          voucherType,
          voucherNumber: operationNumber,
          checkNumber: checkNumber || null,
          description: descriptionText,
          debit,
          credit,
          balance: newSourceBalance,
        },
      })

      // 2. Actualizar saldo de cuenta origen
      await tx.bankAccount.update({
        where: { id: bankAccountId },
        data: { balance: newSourceBalance },
      })

      let destTransaction = null

      // 3. Si es transferencia, crear movimiento en cuenta destino
      if (operationType === 'TRANSFER' && destinationAccountId) {
        const newDestBalance = currentDestBalance + amount

        destTransaction = await tx.bankTransaction.create({
          data: {
            bankAccountId: destinationAccountId,
            date: new Date(date),
            type: 'TRANSFER',
            entityName: null,
            voucherType: 'TRF',
            voucherNumber: operationNumber,
            checkNumber: null,
            description: `Transferencia desde ${sourceAccount.name}`,
            debit: amount,
            credit: 0,
            balance: newDestBalance,
          },
        })

        // 4. Actualizar saldo de cuenta destino
        await tx.bankAccount.update({
          where: { id: destinationAccountId },
          data: { balance: newDestBalance },
        })
      }

      return { sourceTransaction, destTransaction }
    })

    return NextResponse.json({
      success: true,
      operation: {
        ...result.sourceTransaction,
        debit: parseFloat(result.sourceTransaction.debit.toString()),
        credit: parseFloat(result.sourceTransaction.credit.toString()),
        balance: parseFloat(result.sourceTransaction.balance.toString()),
        date: result.sourceTransaction.date.toISOString(),
      },
    })
  } catch (error) {
    console.error('Error creating bank operation:', error)
    return NextResponse.json(
      { error: 'Error al registrar la operación bancaria' },
      { status: 500 }
    )
  }
}

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const filter = searchParams.get('filter') || 'ALL'

    // Construir filtro para cheques
    const where: Record<string, unknown> = {
      checkNumber: { not: null },
    }

    // Filtrar por tipo
    if (filter === 'RECEIVED') {
      where.OR = [
        { voucherType: 'REC' },
        { voucherType: 'CHQ' },
      ]
    } else if (filter === 'ISSUED') {
      where.voucherType = 'PAG'
    }

    // Obtener transacciones con cheques
    const transactions = await prisma.bankTransaction.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        bankAccount: {
          select: {
            name: true,
          },
        },
      },
    })

    // Formatear datos
    const checks = transactions.map(transaction => ({
      id: transaction.id,
      checkNumber: transaction.checkNumber,
      date: transaction.date.toISOString(),
      amount: parseFloat(parseFloat(transaction.debit.toString()) > 0 ? transaction.debit.toString() : transaction.credit.toString()),
      entityName: transaction.entityName,
      description: transaction.description,
      voucherType: transaction.voucherType,
      status: 'PENDING', // Por ahora todos pendientes, en el futuro agregar campo status a BankTransaction
      bankAccountName: transaction.bankAccount.name,
    }))

    return NextResponse.json({
      checks,
      total: checks.length,
    })
  } catch (error) {
    console.error('Error fetching checks:', error)
    return NextResponse.json(
      { error: 'Error al obtener cheques' },
      { status: 500 }
    )
  }
}

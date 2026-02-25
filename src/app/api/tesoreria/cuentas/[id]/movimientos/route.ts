import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

export async function GET(
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

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const skip = (page - 1) * pageSize
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    // Construir filtros
    const where: Record<string, unknown> = { bankAccountId: id }

    if (dateFrom || dateTo) {
      where.date = {}
      if (dateFrom) where.date.gte = new Date(dateFrom)
      if (dateTo) {
        const endDate = new Date(dateTo)
        endDate.setHours(23, 59, 59, 999)
        where.date.lte = endDate
      }
    }

    // Obtener total de transacciones
    const total = await prisma.bankTransaction.count({ where })

    // Obtener transacciones paginadas
    const transactions = await prisma.bankTransaction.findMany({
      where,
      orderBy: { date: 'desc' },
      skip,
      take: pageSize,
    })

    // Convertir Decimal a number
    const transactionsJson = transactions.map(transaction => ({
      ...transaction,
      debit: parseFloat(transaction.debit.toString()),
      credit: parseFloat(transaction.credit.toString()),
      balance: parseFloat(transaction.balance.toString()),
      date: transaction.date.toISOString(),
    }))

    return NextResponse.json({
      transactions: transactionsJson,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    })
  } catch (error) {
    console.error('Error fetching transactions:', error)
    return NextResponse.json(
      { error: 'Error al obtener movimientos' },
      { status: 500 }
    )
  }
}

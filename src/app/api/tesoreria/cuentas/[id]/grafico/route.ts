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
    const period = searchParams.get('period') || 'monthly' // monthly, quarterly, yearly

    // Obtener fecha de inicio según el período
    const endDate = new Date()
    const startDate = new Date()

    let months = 12
    if (period === 'quarterly') {
      months = 12 // 4 trimestres
    } else if (period === 'yearly') {
      months = 36 // 3 años
    }

    startDate.setMonth(startDate.getMonth() - months)

    // Obtener todas las transacciones del período
    const transactions = await prisma.bankTransaction.findMany({
      where: {
        bankAccountId: id,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { date: 'asc' },
    })

    // Agrupar por mes
    const monthlyData: Record<string, { income: number; expense: number; balance: number }> = {}

    for (const transaction of transactions) {
      const monthKey = transaction.date.toISOString().slice(0, 7) // YYYY-MM

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { income: 0, expense: 0, balance: 0 }
      }

      monthlyData[monthKey].income += parseFloat(transaction.debit.toString())
      monthlyData[monthKey].expense += parseFloat(transaction.credit.toString())
    }

    // Calcular saldo acumulado
    let accumulatedBalance = 0
    const chartData = []

    // Generar todos los meses del período
    const current = new Date(startDate)
    while (current <= endDate) {
      const monthKey = current.toISOString().slice(0, 7)
      const data = monthlyData[monthKey] || { income: 0, expense: 0, balance: 0 }

      accumulatedBalance += data.income - data.expense

      chartData.push({
        month: monthKey,
        monthLabel: current.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' }),
        income: data.income,
        expense: data.expense,
        balance: accumulatedBalance,
      })

      current.setMonth(current.getMonth() + 1)
    }

    // Si es quarterly, agrupar por trimestre
    if (period === 'quarterly') {
      const quarterlyData = []
      for (let i = 0; i < chartData.length; i += 3) {
        const quarter = chartData.slice(i, i + 3)
        const q = Math.floor(i / 3) + 1
        const year = quarter[0]?.month.slice(0, 4) || ''

        quarterlyData.push({
          month: `${year}-Q${q}`,
          monthLabel: `Q${q} '${year.slice(2)}`,
          income: quarter.reduce((sum, m) => sum + m.income, 0),
          expense: quarter.reduce((sum, m) => sum + m.expense, 0),
          balance: quarter[quarter.length - 1]?.balance || 0,
        })
      }
      return NextResponse.json(quarterlyData)
    }

    // Si es yearly, agrupar por año
    if (period === 'yearly') {
      const yearlyData: Record<string, { income: number; expense: number; balance: number; months: number }> = {}

      for (const item of chartData) {
        const year = item.month.slice(0, 4)
        if (!yearlyData[year]) {
          yearlyData[year] = { income: 0, expense: 0, balance: 0, months: 0 }
        }
        yearlyData[year].income += item.income
        yearlyData[year].expense += item.expense
        yearlyData[year].balance = item.balance
        yearlyData[year].months++
      }

      return NextResponse.json(
        Object.entries(yearlyData).map(([year, data]) => ({
          month: year,
          monthLabel: year,
          income: data.income,
          expense: data.expense,
          balance: data.balance,
        }))
      )
    }

    return NextResponse.json(chartData)
  } catch (error) {
    console.error('Error fetching chart data:', error)
    return NextResponse.json(
      { error: 'Error al obtener datos del gráfico' },
      { status: 500 }
    )
  }
}

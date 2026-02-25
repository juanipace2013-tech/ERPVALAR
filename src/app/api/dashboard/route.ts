import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import {
  getCashFlowData,
  getIncomeExpenseData,
  getInvoicesToCollectWeekly,
  getExpenseDistribution
} from '@/lib/dashboard-queries'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const chartType = searchParams.get('chart')

    let data

    switch (chartType) {
      case 'cashflow':
        data = await getCashFlowData()
        break
      case 'income-expense':
        data = await getIncomeExpenseData()
        break
      case 'invoices':
        data = await getInvoicesToCollectWeekly()
        break
      case 'expenses':
        data = await getExpenseDistribution()
        break
      default:
        return NextResponse.json({ error: 'Tipo de gráfico inválido' }, { status: 400 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error en dashboard API:', error)
    return NextResponse.json(
      { error: 'Error al obtener datos', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

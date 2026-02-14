import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/contabilidad/estado-resultados - Obtener estado de resultados
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'Se requieren fechas de inicio y fin' },
        { status: 400 }
      )
    }

    // Obtener cuentas de Ingresos y Egresos
    const accounts = await prisma.chartOfAccount.findMany({
      where: {
        isActive: true,
        accountType: {
          in: ['INGRESO', 'EGRESO'],
        },
      },
      orderBy: {
        code: 'asc',
      },
    })

    // Construir filtro para movimientos
    const where: any = {
      journalEntry: {
        status: 'POSTED',
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
    }

    // Obtener movimientos
    const movements = await prisma.journalEntryLine.findMany({
      where,
      include: {
        account: true,
      },
    })

    // Agrupar por cuenta
    const accountTotals = new Map<string, { debit: number; credit: number }>()

    movements.forEach((movement) => {
      if (!['INGRESO', 'EGRESO'].includes(movement.account.accountType)) {
        return
      }

      const accountId = movement.accountId
      const current = accountTotals.get(accountId) || { debit: 0, credit: 0 }

      accountTotals.set(accountId, {
        debit: current.debit + Number(movement.debit),
        credit: current.credit + Number(movement.credit),
      })
    })

    // Construir datos del estado de resultados
    const ingresos = accounts
      .filter((acc) => acc.accountType === 'INGRESO')
      .map((account) => {
        const totals = accountTotals.get(account.id) || { debit: 0, credit: 0 }
        // Para ingresos: Haber - Debe (normalmente crédito)
        const amount = totals.credit - totals.debit

        return {
          account: {
            id: account.id,
            code: account.code,
            name: account.name,
            level: account.level,
          },
          amount,
        }
      })
      .filter((item) => Math.abs(item.amount) > 0.01)

    const egresos = accounts
      .filter((acc) => acc.accountType === 'EGRESO')
      .map((account) => {
        const totals = accountTotals.get(account.id) || { debit: 0, credit: 0 }
        // Para egresos: Debe - Haber (normalmente débito)
        const amount = totals.debit - totals.credit

        return {
          account: {
            id: account.id,
            code: account.code,
            name: account.name,
            level: account.level,
          },
          amount,
        }
      })
      .filter((item) => Math.abs(item.amount) > 0.01)

    // Calcular totales
    const totalIngresos = ingresos.reduce((sum, item) => sum + item.amount, 0)
    const totalEgresos = egresos.reduce((sum, item) => sum + item.amount, 0)
    const resultado = totalIngresos - totalEgresos

    return NextResponse.json({
      period: {
        startDate,
        endDate,
      },
      ingresos,
      egresos,
      totals: {
        ingresos: totalIngresos,
        egresos: totalEgresos,
        resultado,
      },
    })
  } catch (error) {
    console.error('Error fetching estado de resultados:', error)
    return NextResponse.json(
      { error: 'Error al obtener estado de resultados' },
      { status: 500 }
    )
  }
}

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'


import { prisma } from '@/lib/prisma'

// GET /api/contabilidad/balance-sumas-saldos - Obtener balance de sumas y saldos
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    // Obtener todas las cuentas
    const accounts = await prisma.chartOfAccount.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        code: 'asc',
      },
    })

    // Construir filtro para movimientos
    const where: any = {
      journalEntry: {
        status: 'POSTED',
      },
    }

    if (startDate || endDate) {
      where.journalEntry.date = {}
      if (startDate) {
        where.journalEntry.date.gte = new Date(startDate)
      }
      if (endDate) {
        where.journalEntry.date.lte = new Date(endDate)
      }
    }

    // Obtener todos los movimientos
    const movements = await prisma.journalEntryLine.findMany({
      where,
      include: {
        account: true,
      },
    })

    // Agrupar movimientos por cuenta
    const accountMovements = new Map<string, { debit: number; credit: number }>()

    movements.forEach((movement) => {
      const accountId = movement.accountId
      const current = accountMovements.get(accountId) || { debit: 0, credit: 0 }

      accountMovements.set(accountId, {
        debit: current.debit + Number(movement.debit),
        credit: current.credit + Number(movement.credit),
      })
    })

    // Construir balance
    const balanceData = accounts
      .map((account) => {
        const movements = accountMovements.get(account.id)
        if (!movements) return null

        const debit = movements.debit
        const credit = movements.credit

        // Calcular saldo según tipo de cuenta
        let debitBalance = 0
        let creditBalance = 0

        if (['ACTIVO', 'EGRESO'].includes(account.accountType)) {
          // Saldo deudor = Debe - Haber
          const balance = debit - credit
          if (balance > 0) {
            debitBalance = balance
          } else {
            creditBalance = Math.abs(balance)
          }
        } else {
          // Saldo acreedor = Haber - Debe
          const balance = credit - debit
          if (balance > 0) {
            creditBalance = balance
          } else {
            debitBalance = Math.abs(balance)
          }
        }

        return {
          account: {
            id: account.id,
            code: account.code,
            name: account.name,
            accountType: account.accountType,
            level: account.level,
          },
          sums: {
            debit,
            credit,
          },
          balance: {
            debit: debitBalance,
            credit: creditBalance,
          },
        }
      })
      .filter((item) => item !== null)

    // Calcular totales
    const totals = balanceData.reduce(
      (acc, item) => ({
        sums: {
          debit: acc.sums.debit + item!.sums.debit,
          credit: acc.sums.credit + item!.sums.credit,
        },
        balance: {
          debit: acc.balance.debit + item!.balance.debit,
          credit: acc.balance.credit + item!.balance.credit,
        },
      }),
      {
        sums: { debit: 0, credit: 0 },
        balance: { debit: 0, credit: 0 },
      }
    )

    return NextResponse.json({
      data: balanceData,
      totals,
    })
  } catch (error) {
    console.error('Error fetching balance:', error)
    return NextResponse.json(
      { error: 'Error al obtener balance de sumas y saldos' },
      { status: 500 }
    )
  }
}

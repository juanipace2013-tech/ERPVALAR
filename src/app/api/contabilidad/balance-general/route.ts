import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'


import { prisma } from '@/lib/prisma'

// GET /api/contabilidad/balance-general - Obtener balance general
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')

    if (!date) {
      return NextResponse.json(
        { error: 'Se requiere una fecha de corte' },
        { status: 400 }
      )
    }

    // Obtener cuentas de Activo, Pasivo y Patrimonio Neto
    const accounts = await prisma.chartOfAccount.findMany({
      where: {
        isActive: true,
        accountType: {
          in: ['ACTIVO', 'PASIVO', 'PATRIMONIO_NETO'],
        },
      },
      orderBy: {
        code: 'asc',
      },
    })

    // Construir filtro para movimientos hasta la fecha
    const where: any = {
      journalEntry: {
        status: 'POSTED',
        date: {
          lte: new Date(date),
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
      if (!['ACTIVO', 'PASIVO', 'PATRIMONIO_NETO'].includes(movement.account.accountType)) {
        return
      }

      const accountId = movement.accountId
      const current = accountTotals.get(accountId) || { debit: 0, credit: 0 }

      accountTotals.set(accountId, {
        debit: current.debit + Number(movement.debit),
        credit: current.credit + Number(movement.credit),
      })
    })

    // Construir datos del balance
    const activos = accounts
      .filter((acc) => acc.accountType === 'ACTIVO')
      .map((account) => {
        const totals = accountTotals.get(account.id) || { debit: 0, credit: 0 }
        // Para activos: Debe - Haber (saldo deudor)
        const balance = totals.debit - totals.credit

        return {
          account: {
            id: account.id,
            code: account.code,
            name: account.name,
            level: account.level,
          },
          balance,
        }
      })
      .filter((item) => Math.abs(item.balance) > 0.01)

    const pasivos = accounts
      .filter((acc) => acc.accountType === 'PASIVO')
      .map((account) => {
        const totals = accountTotals.get(account.id) || { debit: 0, credit: 0 }
        // Para pasivos: Haber - Debe (saldo acreedor)
        const balance = totals.credit - totals.debit

        return {
          account: {
            id: account.id,
            code: account.code,
            name: account.name,
            level: account.level,
          },
          balance,
        }
      })
      .filter((item) => Math.abs(item.balance) > 0.01)

    const patrimonioNeto = accounts
      .filter((acc) => acc.accountType === 'PATRIMONIO_NETO')
      .map((account) => {
        const totals = accountTotals.get(account.id) || { debit: 0, credit: 0 }
        // Para patrimonio: Haber - Debe (saldo acreedor)
        const balance = totals.credit - totals.debit

        return {
          account: {
            id: account.id,
            code: account.code,
            name: account.name,
            level: account.level,
          },
          balance,
        }
      })
      .filter((item) => Math.abs(item.balance) > 0.01)

    // Calcular totales
    const totalActivo = activos.reduce((sum, item) => sum + item.balance, 0)
    const totalPasivo = pasivos.reduce((sum, item) => sum + item.balance, 0)
    const totalPatrimonio = patrimonioNeto.reduce((sum, item) => sum + item.balance, 0)

    // Calcular resultado del ejercicio
    const resultadoEjercicio = await calcularResultadoEjercicio(date)

    // Total Pasivo + Patrimonio Neto + Resultado
    const totalPasivoPatrimonio = totalPasivo + totalPatrimonio + resultadoEjercicio

    return NextResponse.json({
      date,
      activo: activos,
      pasivo: pasivos,
      patrimonioNeto: patrimonioNeto,
      resultadoEjercicio,
      totals: {
        activo: totalActivo,
        pasivo: totalPasivo,
        patrimonioNeto: totalPatrimonio,
        pasivoPatrimonio: totalPasivoPatrimonio,
      },
    })
  } catch (error) {
    console.error('Error fetching balance general:', error)
    return NextResponse.json(
      { error: 'Error al obtener balance general' },
      { status: 500 }
    )
  }
}

async function calcularResultadoEjercicio(date: string) {
  // Obtener movimientos de ingresos y egresos hasta la fecha
  const movements = await prisma.journalEntryLine.findMany({
    where: {
      journalEntry: {
        status: 'POSTED',
        date: {
          lte: new Date(date),
        },
      },
    },
    include: {
      account: true,
    },
  })

  let totalIngresos = 0
  let totalEgresos = 0

  movements.forEach((movement) => {
    const debit = Number(movement.debit)
    const credit = Number(movement.credit)

    if (movement.account.accountType === 'INGRESO') {
      totalIngresos += credit - debit
    } else if (movement.account.accountType === 'EGRESO') {
      totalEgresos += debit - credit
    }
  })

  return totalIngresos - totalEgresos
}

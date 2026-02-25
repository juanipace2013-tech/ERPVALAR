import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { calculateRunningBalance } from '@/lib/contabilidad/balance-helper'

// GET /api/contabilidad/libro-mayor - Obtener movimientos del libro mayor
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const accountId = searchParams.get('accountId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const showAll = searchParams.get('showAll') === 'true'

    // Construir filtros para journal entry
    const journalEntryFilter: any = {
      status: 'POSTED', // Solo asientos confirmados
    }

    if (startDate || endDate) {
      journalEntryFilter.date = {}
      if (startDate) {
        journalEntryFilter.date.gte = new Date(startDate)
      }
      if (endDate) {
        journalEntryFilter.date.lte = new Date(endDate)
      }
    }

    // Modo 1: Libro Mayor completo (todas las cuentas)
    if (showAll) {
      // Obtener todas las cuentas con movimientos
      const accountsWithMovements = await prisma.journalEntryLine.groupBy({
        by: ['accountId'],
        where: {
          journalEntry: journalEntryFilter,
        },
        _count: true,
      })

      // Para cada cuenta, obtener sus movimientos
      const accountsData = await Promise.all(
        accountsWithMovements.map(async (item) => {
          const account = await prisma.chartOfAccount.findUnique({
            where: { id: item.accountId },
          })

          if (!account) return null

          const movements = await prisma.journalEntryLine.findMany({
            where: {
              accountId: item.accountId,
              journalEntry: journalEntryFilter,
            },
            include: {
              journalEntry: {
                select: {
                  id: true,
                  entryNumber: true,
                  date: true,
                  description: true,
                },
              },
              account: {
                select: {
                  code: true,
                  name: true,
                },
              },
            },
            orderBy: [
              { journalEntry: { date: 'asc' } },
              { journalEntry: { entryNumber: 'asc' } },
            ],
          })

          // Calcular saldos correctamente (siempre positivos)
          let runningBalance = { amount: 0, nature: 'DEUDOR' as const }
          const movementsWithBalance = movements.map((movement) => {
            const debit = Number(movement.debit)
            const credit = Number(movement.credit)

            // Calcular saldo acumulado
            runningBalance = calculateRunningBalance(
              account.accountType,
              runningBalance,
              debit,
              credit
            )

            return {
              ...movement,
              balance: runningBalance.amount,
              balanceNature: runningBalance.nature,
            }
          })

          const totalDebit = movements.reduce((sum, m) => sum + Number(m.debit), 0)
          const totalCredit = movements.reduce((sum, m) => sum + Number(m.credit), 0)

          return {
            account,
            movements: movementsWithBalance,
            totals: {
              debit: totalDebit,
              credit: totalCredit,
              balance: runningBalance.amount,
              balanceNature: runningBalance.nature,
            },
          }
        })
      )

      // Filtrar nulls y ordenar por código de cuenta
      const validAccounts = accountsData
        .filter((item) => item !== null)
        .sort((a, b) => a!.account.code.localeCompare(b!.account.code))

      return NextResponse.json({
        showAll: true,
        accounts: validAccounts,
      })
    }

    // Modo 2: Libro Mayor de una cuenta específica
    if (!accountId) {
      return NextResponse.json(
        { error: 'Se requiere el ID de la cuenta o usar showAll=true' },
        { status: 400 }
      )
    }

    // Obtener información de la cuenta
    const account = await prisma.chartOfAccount.findUnique({
      where: { id: accountId },
    })

    if (!account) {
      return NextResponse.json(
        { error: 'Cuenta no encontrada' },
        { status: 404 }
      )
    }

    const where = {
      accountId,
      journalEntry: journalEntryFilter,
    }

    // Obtener movimientos
    const movements = await prisma.journalEntryLine.findMany({
      where,
      include: {
        journalEntry: {
          select: {
            id: true,
            entryNumber: true,
            date: true,
            description: true,
          },
        },
      },
      orderBy: [
        { journalEntry: { date: 'asc' } },
        { journalEntry: { entryNumber: 'asc' } },
      ],
    })

    // Calcular saldos correctamente (siempre positivos)
    let runningBalance = { amount: 0, nature: 'DEUDOR' as const }
    const movementsWithBalance = movements.map((movement) => {
      const debit = Number(movement.debit)
      const credit = Number(movement.credit)

      // Calcular saldo acumulado
      runningBalance = calculateRunningBalance(
        account.accountType,
        runningBalance,
        debit,
        credit
      )

      return {
        ...movement,
        balance: runningBalance.amount,
        balanceNature: runningBalance.nature,
      }
    })

    // Calcular totales
    const totalDebit = movements.reduce((sum, m) => sum + Number(m.debit), 0)
    const totalCredit = movements.reduce((sum, m) => sum + Number(m.credit), 0)

    return NextResponse.json({
      showAll: false,
      account,
      movements: movementsWithBalance,
      totals: {
        debit: totalDebit,
        credit: totalCredit,
        balance: runningBalance.amount,
        balanceNature: runningBalance.nature,
      },
    })
  } catch (error) {
    console.error('Error fetching libro mayor:', error)
    return NextResponse.json(
      { error: 'Error al obtener libro mayor' },
      { status: 500 }
    )
  }
}

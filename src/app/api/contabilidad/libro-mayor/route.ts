import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/contabilidad/libro-mayor - Obtener movimientos de una cuenta
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const accountId = searchParams.get('accountId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!accountId) {
      return NextResponse.json(
        { error: 'Se requiere el ID de la cuenta' },
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

    // Construir filtros
    const where: any = {
      accountId,
      journalEntry: {
        status: 'POSTED', // Solo asientos confirmados
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

    // Calcular saldos
    let balance = 0
    const movementsWithBalance = movements.map((movement) => {
      const debit = Number(movement.debit)
      const credit = Number(movement.credit)

      // Para cuentas de Activo y Egreso: Debe aumenta, Haber disminuye
      // Para cuentas de Pasivo, Patrimonio e Ingreso: Haber aumenta, Debe disminuye
      if (['ACTIVO', 'EGRESO'].includes(account.accountType)) {
        balance += debit - credit
      } else {
        balance += credit - debit
      }

      return {
        ...movement,
        balance,
      }
    })

    // Calcular totales
    const totalDebit = movements.reduce((sum, m) => sum + Number(m.debit), 0)
    const totalCredit = movements.reduce((sum, m) => sum + Number(m.credit), 0)

    return NextResponse.json({
      account,
      movements: movementsWithBalance,
      totals: {
        debit: totalDebit,
        credit: totalCredit,
        balance,
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

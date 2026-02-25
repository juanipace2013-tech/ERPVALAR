import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

// POST /api/contabilidad/asientos/[id]/confirm - Confirmar asiento
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Solo ADMIN o CONTADOR pueden confirmar asientos
    if (!['ADMIN', 'CONTADOR'].includes(session.user.role)) {
      return NextResponse.json(
        { error: 'No tienes permisos para confirmar asientos contables' },
        { status: 403 }
      )
    }

    const { id } = await params

    // Verificar que el asiento existe
    const entry = await prisma.journalEntry.findUnique({
      where: { id },
      include: {
        lines: true,
      },
    })

    if (!entry) {
      return NextResponse.json(
        { error: 'Asiento no encontrado' },
        { status: 404 }
      )
    }

    // Verificar que está en borrador
    if (entry.status !== 'DRAFT') {
      return NextResponse.json(
        { error: 'El asiento ya está confirmado o anulado' },
        { status: 400 }
      )
    }

    // Validar partida doble (Debe = Haber)
    const totalDebit = entry.lines.reduce((sum, line) => sum + Number(line.debit), 0)
    const totalCredit = entry.lines.reduce((sum, line) => sum + Number(line.credit), 0)

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return NextResponse.json(
        {
          error: 'El asiento no cumple con partida doble',
          totalDebit,
          totalCredit,
          difference: totalDebit - totalCredit,
        },
        { status: 400 }
      )
    }

    // Confirmar asiento
    const confirmedEntry = await prisma.journalEntry.update({
      where: { id },
      data: {
        status: 'POSTED',
      },
      include: {
        lines: {
          include: {
            account: true,
          },
        },
      },
    })

    return NextResponse.json(confirmedEntry)
  } catch (error) {
    console.error('Error confirming journal entry:', error)
    return NextResponse.json(
      { error: 'Error al confirmar asiento contable' },
      { status: 500 }
    )
  }
}

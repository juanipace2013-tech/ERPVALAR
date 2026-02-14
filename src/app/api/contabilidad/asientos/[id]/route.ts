import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { journalEntrySchema } from '@/lib/contabilidad/validations'
import { z } from 'zod'

// GET /api/contabilidad/asientos/[id] - Obtener asiento por ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params

    const entry = await prisma.journalEntry.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            account: true,
          },
          orderBy: { id: 'asc' },
        },
      },
    })

    if (!entry) {
      return NextResponse.json(
        { error: 'Asiento no encontrado' },
        { status: 404 }
      )
    }

    return NextResponse.json(entry)
  } catch (error) {
    console.error('Error fetching journal entry:', error)
    return NextResponse.json(
      { error: 'Error al obtener asiento contable' },
      { status: 500 }
    )
  }
}

// PUT /api/contabilidad/asientos/[id] - Actualizar asiento
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Solo ADMIN o CONTADOR pueden editar asientos
    if (!['ADMIN', 'CONTADOR'].includes(session.user.role)) {
      return NextResponse.json(
        { error: 'No tienes permisos para editar asientos contables' },
        { status: 403 }
      )
    }

    const { id } = await params
    const body = await request.json()

    // Verificar que el asiento existe
    const existing = await prisma.journalEntry.findUnique({
      where: { id },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Asiento no encontrado' },
        { status: 404 }
      )
    }

    // Solo permitir editar si está en borrador
    if (existing.status !== 'DRAFT') {
      return NextResponse.json(
        { error: 'Solo se pueden editar asientos en borrador' },
        { status: 400 }
      )
    }

    const validatedData = journalEntrySchema.parse(body)

    // Validar que todas las cuentas existen y aceptan asientos
    const accountIds = validatedData.lines.map(line => line.accountId)
    const accounts = await prisma.chartOfAccount.findMany({
      where: {
        id: { in: accountIds },
      },
    })

    if (accounts.length !== accountIds.length) {
      return NextResponse.json(
        { error: 'Una o más cuentas no existen' },
        { status: 400 }
      )
    }

    const accountsNotAcceptingEntries = accounts.filter(acc => !acc.acceptsEntries)
    if (accountsNotAcceptingEntries.length > 0) {
      return NextResponse.json(
        {
          error: 'Las siguientes cuentas no aceptan asientos',
          accounts: accountsNotAcceptingEntries.map(acc => ({
            code: acc.code,
            name: acc.name,
          })),
        },
        { status: 400 }
      )
    }

    // Eliminar líneas existentes y crear nuevas
    await prisma.journalEntryLine.deleteMany({
      where: { journalEntryId: id },
    })

    const entry = await prisma.journalEntry.update({
      where: { id },
      data: {
        date: new Date(validatedData.date),
        description: validatedData.description,
        status: (validatedData as any).status || existing.status,
        lines: {
          create: validatedData.lines.map(line => ({
            accountId: line.accountId,
            description: line.description,
            debit: line.debit,
            credit: line.credit,
          })),
        },
      },
      include: {
        lines: {
          include: {
            account: true,
          },
        },
      },
    })

    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: (error as any).errors },
        { status: 400 }
      )
    }

    console.error('Error updating journal entry:', error)
    return NextResponse.json(
      { error: 'Error al actualizar asiento contable' },
      { status: 500 }
    )
  }
}

// DELETE /api/contabilidad/asientos/[id] - Eliminar asiento
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Solo ADMIN puede eliminar asientos
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'No tienes permisos para eliminar asientos contables' },
        { status: 403 }
      )
    }

    const { id } = await params

    // Verificar que el asiento existe
    const entry = await prisma.journalEntry.findUnique({
      where: { id },
    })

    if (!entry) {
      return NextResponse.json(
        { error: 'Asiento no encontrado' },
        { status: 404 }
      )
    }

    // Solo permitir eliminar si está en borrador
    if (entry.status !== 'DRAFT') {
      return NextResponse.json(
        { error: 'Solo se pueden eliminar asientos en borrador' },
        { status: 400 }
      )
    }

    // Eliminar líneas y asiento
    await prisma.journalEntryLine.deleteMany({
      where: { journalEntryId: id },
    })

    await prisma.journalEntry.delete({
      where: { id },
    })

    return NextResponse.json({ message: 'Asiento eliminado exitosamente' })
  } catch (error) {
    console.error('Error deleting journal entry:', error)
    return NextResponse.json(
      { error: 'Error al eliminar asiento contable' },
      { status: 500 }
    )
  }
}

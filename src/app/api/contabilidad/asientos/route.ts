import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'


import { prisma } from '@/lib/prisma'
import { journalEntrySchema } from '@/lib/contabilidad/validations'
import { z } from 'zod'

// GET /api/contabilidad/asientos - Listar asientos contables
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')

    const where: any = {}

    if (status && status !== 'all') {
      where.status = status
    }

    if (startDate) {
      where.date = {
        ...where.date,
        gte: new Date(startDate),
      }
    }

    if (endDate) {
      where.date = {
        ...where.date,
        lte: new Date(endDate),
      }
    }

    const [entries, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        include: {
          lines: {
            include: {
              account: {
                select: {
                  code: true,
                  name: true,
                },
              },
            },
            orderBy: { id: 'asc' },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              lines: true,
            },
          },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.journalEntry.count({ where }),
    ])

    return NextResponse.json({
      entries,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching journal entries:', error)
    return NextResponse.json(
      { error: 'Error al obtener asientos contables' },
      { status: 500 }
    )
  }
}

// POST /api/contabilidad/asientos - Crear asiento contable
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Solo ADMIN o CONTADOR pueden crear asientos
    if (!['ADMIN', 'CONTADOR'].includes(session.user.role)) {
      return NextResponse.json(
        { error: 'No tienes permisos para crear asientos contables' },
        { status: 403 }
      )
    }

    const body = await request.json()
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

    // Verificar que todas las cuentas acepten asientos
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

    // Crear asiento con líneas
    const entry = await prisma.journalEntry.create({
      data: {
        date: new Date(validatedData.date),
        description: validatedData.description,
        status: (validatedData as any).status || 'DRAFT',
        user: {
          connect: { id: session.user.id },
        },
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

    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: (error as any).errors },
        { status: 400 }
      )
    }

    console.error('Error creating journal entry:', error)
    return NextResponse.json(
      { error: 'Error al crear asiento contable' },
      { status: 500 }
    )
  }
}

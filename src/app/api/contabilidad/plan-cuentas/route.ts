import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'


import { prisma } from '@/lib/prisma'
import { chartOfAccountSchema, calculateLevel, getParentCode } from '@/lib/contabilidad/validations'
import { z } from 'zod'

// GET /api/contabilidad/plan-cuentas - Listar todas las cuentas
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const accountType = searchParams.get('accountType')
    const level = searchParams.get('level')
    const activeOnly = searchParams.get('activeOnly') === 'true'
    const acceptsEntries = searchParams.get('acceptsEntries') === 'true'

    const where: any = {}

    if (accountType) {
      where.accountType = accountType
    }

    if (level) {
      where.level = parseInt(level)
    }

    if (activeOnly) {
      where.isActive = true
    }

    if (acceptsEntries) {
      where.acceptsEntries = true
    }

    const accounts = await prisma.chartOfAccount.findMany({
      where,
      include: {
        parent: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        _count: {
          select: {
            children: true,
            journalEntryLines: true,
          },
        },
      },
      orderBy: {
        code: 'asc',
      },
    })

    return NextResponse.json(accounts)
  } catch (error) {
    console.error('Error fetching chart of accounts:', error)
    return NextResponse.json(
      { error: 'Error al obtener plan de cuentas' },
      { status: 500 }
    )
  }
}

// POST /api/contabilidad/plan-cuentas - Crear nueva cuenta
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Solo ADMIN o CONTADOR pueden crear cuentas
    if (!['ADMIN', 'CONTADOR'].includes(session.user.role)) {
      return NextResponse.json(
        { error: 'No tienes permisos para crear cuentas' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const validatedData = chartOfAccountSchema.parse(body)

    // Calcular nivel basado en el código
    const level = calculateLevel(validatedData.code)

    // Verificar si el código ya existe
    const existing = await prisma.chartOfAccount.findUnique({
      where: { code: validatedData.code },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'Ya existe una cuenta con este código' },
        { status: 400 }
      )
    }

    // Si tiene parent ID, verificar que exista y sea del mismo tipo
    let parentId = validatedData.parentId

    if (level > 1) {
      // Buscar padre por código si no se especificó
      if (!parentId) {
        const parentCode = getParentCode(validatedData.code)
        if (parentCode) {
          const parent = await prisma.chartOfAccount.findUnique({
            where: { code: parentCode },
          })
          if (parent) {
            parentId = parent.id
          }
        }
      }

      // Verificar que el padre sea del mismo tipo
      if (parentId) {
        const parent = await prisma.chartOfAccount.findUnique({
          where: { id: parentId },
        })

        if (!parent) {
          return NextResponse.json(
            { error: 'La cuenta padre no existe' },
            { status: 400 }
          )
        }

        if (parent.accountType !== validatedData.accountType) {
          return NextResponse.json(
            { error: 'La cuenta debe ser del mismo tipo que su cuenta padre' },
            { status: 400 }
          )
        }
      }
    }

    // Crear cuenta
    const account = await prisma.chartOfAccount.create({
      data: {
        code: validatedData.code,
        name: validatedData.name,
        accountType: validatedData.accountType,
        level,
        parentId: parentId || null,
        acceptsEntries: validatedData.acceptsEntries,
      },
      include: {
        parent: true,
      },
    })

    return NextResponse.json(account, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: (error as any).errors },
        { status: 400 }
      )
    }

    console.error('Error creating account:', error)
    return NextResponse.json(
      { error: 'Error al crear cuenta' },
      { status: 500 }
    )
  }
}

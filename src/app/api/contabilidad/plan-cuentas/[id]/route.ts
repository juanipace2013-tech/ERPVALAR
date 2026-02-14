import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { chartOfAccountSchema, calculateLevel } from '@/lib/contabilidad/validations'
import { z } from 'zod'

// GET /api/contabilidad/plan-cuentas/[id] - Obtener cuenta por ID
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

    const account = await prisma.chartOfAccount.findUnique({
      where: { id },
      include: {
        parent: true,
        children: {
          orderBy: { code: 'asc' },
        },
        _count: {
          select: {
            journalEntryLines: true,
          },
        },
      },
    })

    if (!account) {
      return NextResponse.json(
        { error: 'Cuenta no encontrada' },
        { status: 404 }
      )
    }

    return NextResponse.json(account)
  } catch (error) {
    console.error('Error fetching account:', error)
    return NextResponse.json(
      { error: 'Error al obtener cuenta' },
      { status: 500 }
    )
  }
}

// PUT /api/contabilidad/plan-cuentas/[id] - Actualizar cuenta
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Solo ADMIN o CONTADOR pueden editar cuentas
    if (!['ADMIN', 'CONTADOR'].includes(session.user.role)) {
      return NextResponse.json(
        { error: 'No tienes permisos para editar cuentas' },
        { status: 403 }
      )
    }

    const { id } = await params
    const body = await request.json()

    // Verificar que la cuenta existe
    const existing = await prisma.chartOfAccount.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            journalEntryLines: true,
          },
        },
      },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Cuenta no encontrada' },
        { status: 404 }
      )
    }

    // Solo permitir editar nombre y acceptsEntries si la cuenta tiene asientos
    if (existing._count.journalEntryLines > 0) {
      const limitedUpdate = await prisma.chartOfAccount.update({
        where: { id },
        data: {
          name: body.name || existing.name,
          acceptsEntries: body.acceptsEntries ?? existing.acceptsEntries,
        },
        include: {
          parent: true,
        },
      })

      return NextResponse.json(limitedUpdate)
    }

    // Si no tiene asientos, permitir edición completa
    const validatedData = chartOfAccountSchema.parse(body)
    const level = calculateLevel(validatedData.code)

    // Verificar si el código cambió y ya existe
    if (validatedData.code !== existing.code) {
      const codeExists = await prisma.chartOfAccount.findFirst({
        where: {
          code: validatedData.code,
          id: { not: id },
        },
      })

      if (codeExists) {
        return NextResponse.json(
          { error: 'Ya existe otra cuenta con este código' },
          { status: 400 }
        )
      }
    }

    const account = await prisma.chartOfAccount.update({
      where: { id },
      data: {
        code: validatedData.code,
        name: validatedData.name,
        accountType: validatedData.accountType,
        level,
        parentId: validatedData.parentId || null,
        acceptsEntries: validatedData.acceptsEntries,
      },
      include: {
        parent: true,
      },
    })

    return NextResponse.json(account)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: (error as any).errors },
        { status: 400 }
      )
    }

    console.error('Error updating account:', error)
    return NextResponse.json(
      { error: 'Error al actualizar cuenta' },
      { status: 500 }
    )
  }
}

// DELETE /api/contabilidad/plan-cuentas/[id] - Eliminar cuenta
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Solo ADMIN puede eliminar cuentas
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'No tienes permisos para eliminar cuentas' },
        { status: 403 }
      )
    }

    const { id } = await params

    // Verificar que la cuenta existe
    const account = await prisma.chartOfAccount.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            children: true,
            journalEntryLines: true,
          },
        },
      },
    })

    if (!account) {
      return NextResponse.json(
        { error: 'Cuenta no encontrada' },
        { status: 404 }
      )
    }

    // No permitir eliminar si tiene hijos o asientos
    if (account._count.children > 0) {
      return NextResponse.json(
        { error: 'No se puede eliminar una cuenta con subcuentas' },
        { status: 400 }
      )
    }

    if (account._count.journalEntryLines > 0) {
      return NextResponse.json(
        { error: 'No se puede eliminar una cuenta con asientos registrados' },
        { status: 400 }
      )
    }

    // Eliminar cuenta
    await prisma.chartOfAccount.delete({
      where: { id },
    })

    return NextResponse.json({ message: 'Cuenta eliminada exitosamente' })
  } catch (error) {
    console.error('Error deleting account:', error)
    return NextResponse.json(
      { error: 'Error al eliminar cuenta' },
      { status: 500 }
    )
  }
}

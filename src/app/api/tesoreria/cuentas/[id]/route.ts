import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const updateSchema = z.object({
  name:             z.string().min(1).optional(),
  type:             z.enum(['BANCO_CUENTA_CORRIENTE', 'BANCO_CAJA_AHORRO', 'CAJA', 'VALORES_A_DEPOSITAR']).optional(),
  bankName:         z.string().optional().nullable(),
  accountNumber:    z.string().optional().nullable(),
  chartOfAccountId: z.string().cuid().optional(),
  isActive:         z.boolean().optional(),
})

// GET /api/tesoreria/cuentas/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const account = await prisma.treasuryAccount.findUnique({
      where: { id: params.id },
      include: {
        chartOfAccount: { select: { id: true, code: true, name: true } }
      }
    })

    if (!account) {
      return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 404 })
    }

    return NextResponse.json({ account })
  } catch (error) {
    console.error('[GET /api/tesoreria/cuentas/[id]]', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

// PUT /api/tesoreria/cuentas/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    if (!['ADMIN', 'CONTADOR'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Sin permisos para esta acción' }, { status: 403 })
    }

    const body = await request.json()
    const validation = updateSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: validation.error.flatten() },
        { status: 400 }
      )
    }

    const existing = await prisma.treasuryAccount.findUnique({ where: { id: params.id } })
    if (!existing) {
      return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 404 })
    }

    // Si cambia la cuenta contable, verificar que existe y acepta asientos
    if (validation.data.chartOfAccountId) {
      const chartAccount = await prisma.chartOfAccount.findUnique({
        where: { id: validation.data.chartOfAccountId },
        select: { acceptsEntries: true, code: true }
      })
      if (!chartAccount) {
        return NextResponse.json({ error: 'Cuenta contable no encontrada' }, { status: 404 })
      }
      if (!chartAccount.acceptsEntries) {
        return NextResponse.json(
          { error: `La cuenta ${chartAccount.code} no acepta asientos directos` },
          { status: 400 }
        )
      }
    }

    const account = await prisma.treasuryAccount.update({
      where: { id: params.id },
      data: validation.data,
      include: {
        chartOfAccount: { select: { id: true, code: true, name: true } }
      }
    })

    return NextResponse.json({ account })
  } catch (error) {
    console.error('[PUT /api/tesoreria/cuentas/[id]]', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

// DELETE /api/tesoreria/cuentas/[id] — soft delete (isActive = false)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    if (!['ADMIN', 'CONTADOR'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Sin permisos para esta acción' }, { status: 403 })
    }

    const existing = await prisma.treasuryAccount.findUnique({ where: { id: params.id } })
    if (!existing) {
      return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 404 })
    }

    // Verificar que no tiene recibos asociados activos
    const usedInReceipts = await prisma.receiptPaymentMethod.count({
      where: { treasuryAccountId: params.id }
    })
    if (usedInReceipts > 0) {
      // Solo desactivar, no borrar
      await prisma.treasuryAccount.update({
        where: { id: params.id },
        data: { isActive: false }
      })
      return NextResponse.json({
        message: 'Cuenta desactivada (tiene recibos asociados, no se puede eliminar)'
      })
    }

    await prisma.treasuryAccount.delete({ where: { id: params.id } })
    return NextResponse.json({ message: 'Cuenta eliminada correctamente' })
  } catch (error) {
    console.error('[DELETE /api/tesoreria/cuentas/[id]]', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

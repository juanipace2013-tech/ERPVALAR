import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const treasuryAccountSchema = z.object({
  name:            z.string().min(1, 'El nombre es requerido'),
  type:            z.enum(['BANCO_CUENTA_CORRIENTE', 'BANCO_CAJA_AHORRO', 'CAJA', 'VALORES_A_DEPOSITAR']),
  bankName:        z.string().optional(),
  accountNumber:   z.string().optional(),
  chartOfAccountId: z.string().cuid('Debe seleccionar una cuenta contable válida'),
})

// GET /api/tesoreria/cuentas - Listar cuentas de tesorería
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const onlyActive = searchParams.get('active') !== 'false'

    const accounts = await prisma.treasuryAccount.findMany({
      where: onlyActive ? { isActive: true } : undefined,
      include: {
        chartOfAccount: {
          select: { id: true, code: true, name: true }
        }
      },
      orderBy: { name: 'asc' }
    })

    return NextResponse.json({ accounts })
  } catch (error) {
    console.error('[GET /api/tesoreria/cuentas]', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

// POST /api/tesoreria/cuentas - Crear cuenta de tesorería
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Solo ADMIN y CONTADOR pueden crear cuentas de tesorería
    if (!['ADMIN', 'CONTADOR'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Sin permisos para esta acción' }, { status: 403 })
    }

    const body = await request.json()
    const validation = treasuryAccountSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: validation.error.flatten() },
        { status: 400 }
      )
    }

    const data = validation.data

    // Verificar que la cuenta contable existe y acepta asientos
    const chartAccount = await prisma.chartOfAccount.findUnique({
      where: { id: data.chartOfAccountId },
      select: { id: true, code: true, name: true, acceptsEntries: true }
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

    const account = await prisma.treasuryAccount.create({
      data: {
        name:             data.name,
        type:             data.type,
        bankName:         data.bankName,
        accountNumber:    data.accountNumber,
        chartOfAccountId: data.chartOfAccountId,
      },
      include: {
        chartOfAccount: {
          select: { id: true, code: true, name: true }
        }
      }
    })

    return NextResponse.json({ account }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/tesoreria/cuentas]', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

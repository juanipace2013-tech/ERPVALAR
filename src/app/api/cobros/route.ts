import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createReceipt } from '@/lib/cobros/receipt.service'
import { z } from 'zod'

// Schema de validación para crear un recibo
const createReceiptSchema = z.object({
  customerId:   z.string().cuid('Cliente inválido'),
  date:         z.coerce.date(),
  description:  z.string().optional(),
  pointOfSale:  z.string().default('0001'),

  invoiceApplications: z.array(z.object({
    invoiceId:     z.string().cuid(),
    appliedAmount: z.number().positive('El monto debe ser positivo'),
  })).min(1, 'Debe aplicar al menos una factura'),

  withholdingGroups: z.array(z.object({
    groupType: z.enum(['IIBB', 'IVA', 'SUSS', 'GANANCIAS']),
    lines: z.array(z.object({
      withholdingType:   z.string().min(1),
      jurisdictionLabel: z.string().optional(),
      certificateNumber: z.string().optional(),
      amount:            z.number().nonnegative('El importe no puede ser negativo'),
    })).min(1),
  })).default([]),

  paymentMethods: z.array(z.object({
    treasuryAccountId: z.string().cuid('Cuenta de tesorería inválida'),
    paymentType:       z.enum(['TRANSFERENCIA', 'CHEQUE', 'EFECTIVO', 'DEPOSITO', 'OTROS']),
    amount:            z.number().positive('El monto debe ser positivo'),
    checkNumber:       z.string().optional(),
    checkDate:         z.string().optional(),
    checkBank:         z.string().optional(),
    reference:         z.string().optional(),
    notes:             z.string().optional(),
  })).min(1, 'Debe agregar al menos un medio de cobro'),
})

// GET /api/cobros — Listar recibos
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const customerId  = searchParams.get('customerId')
    const status      = searchParams.get('status')
    const startDate   = searchParams.get('startDate')
    const endDate     = searchParams.get('endDate')
    const search      = searchParams.get('search')
    const page        = parseInt(searchParams.get('page') || '1')
    const pageSize    = parseInt(searchParams.get('pageSize') || '20')

    const where: any = {}
    if (customerId) where.customerId = customerId
    if (status)     where.status = status
    if (startDate || endDate) {
      where.date = {}
      if (startDate) where.date.gte = new Date(startDate)
      if (endDate)   where.date.lte = new Date(endDate)
    }
    if (search) {
      where.OR = [
        { receiptNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ]
    }

    const [receipts, total] = await Promise.all([
      prisma.receipt.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, cuit: true } },
          user:     { select: { id: true, name: true } },
          journalEntry: { select: { id: true, entryNumber: true } },
          _count: {
            select: { invoiceApplications: true, withholdingGroups: true }
          }
        },
        orderBy: { date: 'desc' },
        skip:  (page - 1) * pageSize,
        take:  pageSize,
      }),
      prisma.receipt.count({ where }),
    ])

    // Stats generales (sin filtros de paginación)
    const stats = await prisma.receipt.aggregate({
      where,
      _sum: {
        totalApplied:      true,
        totalWithholdings: true,
        totalCobrado:      true,
      },
      _count: { _all: true }
    })

    const statsByStatus = await prisma.receipt.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _sum:   { totalApplied: true }
    })

    return NextResponse.json({
      receipts,
      pagination: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      stats: {
        totalApplied:      Number(stats._sum.totalApplied ?? 0),
        totalWithholdings: Number(stats._sum.totalWithholdings ?? 0),
        totalCobrado:      Number(stats._sum.totalCobrado ?? 0),
        count:             stats._count._all,
        byStatus:          statsByStatus,
      }
    })
  } catch (error) {
    console.error('[GET /api/cobros]', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

// POST /api/cobros — Crear recibo en BORRADOR
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json()
    const validation = createReceiptSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: validation.error.flatten() },
        { status: 400 }
      )
    }

    const receipt = await createReceipt({
      ...validation.data,
      userId: session.user.id,
    })

    return NextResponse.json({ receipt }, { status: 201 })
  } catch (error: any) {
    console.error('[POST /api/cobros]', error)
    if (error?.message) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

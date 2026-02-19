import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'


import { prisma } from '@/lib/prisma'
import { updateReceipt } from '@/lib/cobros/receipt.service'
import { z } from 'zod'

const updateReceiptSchema = z.object({
  date:        z.coerce.date(),
  description: z.string().optional(),

  invoiceApplications: z.array(z.object({
    invoiceId:     z.string().cuid(),
    appliedAmount: z.number().positive(),
  })).min(1),

  withholdingGroups: z.array(z.object({
    groupType: z.enum(['IIBB', 'IVA', 'SUSS', 'GANANCIAS']),
    lines: z.array(z.object({
      withholdingType:   z.string().min(1),
      jurisdictionLabel: z.string().optional(),
      certificateNumber: z.string().optional(),
      amount:            z.number().nonnegative(),
    })).min(1),
  })).default([]),

  paymentMethods: z.array(z.object({
    treasuryAccountId: z.string().cuid(),
    paymentType:       z.enum(['TRANSFERENCIA', 'CHEQUE', 'EFECTIVO', 'DEPOSITO', 'OTROS']),
    amount:            z.number().positive(),
    checkNumber:       z.string().optional(),
    checkDate:         z.string().optional(),
    checkBank:         z.string().optional(),
    reference:         z.string().optional(),
    notes:             z.string().optional(),
  })).min(1),
})

// GET /api/cobros/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const receipt = await prisma.receipt.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, cuit: true, taxCondition: true } },
        user:     { select: { id: true, name: true } },
        invoiceApplications: {
          include: {
            invoice: {
              select: {
                id: true, invoiceNumber: true, invoiceType: true,
                total: true, paidAmount: true, dueDate: true, issueDate: true, currency: true
              }
            }
          }
        },
        withholdingGroups: { include: { lines: true } },
        paymentMethods: {
          include: {
            treasuryAccount: {
              include: { chartOfAccount: { select: { id: true, code: true, name: true } } }
            }
          }
        },
        journalEntry: { select: { id: true, entryNumber: true, status: true } }
      }
    })

    if (!receipt) {
      return NextResponse.json({ error: 'Recibo no encontrado' }, { status: 404 })
    }

    return NextResponse.json({ receipt })
  } catch (error) {
    console.error('[GET /api/cobros/[id]]', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

// PUT /api/cobros/[id] — Solo si está en BORRADOR
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const existing = await prisma.receipt.findUnique({
      where: { id },
      select: { status: true, customerId: true }
    })
    if (!existing) {
      return NextResponse.json({ error: 'Recibo no encontrado' }, { status: 404 })
    }
    if (existing.status !== 'BORRADOR') {
      return NextResponse.json(
        { error: 'Solo se pueden editar recibos en estado BORRADOR' },
        { status: 422 }
      )
    }

    const body = await request.json()
    const validation = updateReceiptSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: validation.error.flatten() },
        { status: 400 }
      )
    }

    const receipt = await updateReceipt(id, {
      ...validation.data,
      customerId: existing.customerId,
      userId:     session.user.id,
    })

    return NextResponse.json({ receipt })
  } catch (error: any) {
    console.error('[PUT /api/cobros/[id]]', error)
    if (error?.message) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

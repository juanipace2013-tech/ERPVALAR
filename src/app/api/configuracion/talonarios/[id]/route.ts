import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'

const invoiceNumberingUpdateSchema = z.object({
  description: z.string().min(1).optional(),
  prefix: z.string().min(1).optional(),
  numberFrom: z.number().int().nonnegative().optional(),
  numberTo: z.number().int().positive().optional(),
  currentNumber: z.number().int().nonnegative().optional(),
  isDefault: z.boolean().optional(),
  numberingMethod: z.enum(['MANUAL', 'AUTOMATIC']).optional(),
  isSaleInvoice: z.boolean().optional(),
  isDebitNote: z.boolean().optional(),
  isCreditNote: z.boolean().optional(),
  isPaymentOrder: z.boolean().optional(),
  isReceipt: z.boolean().optional(),
  isRemittance: z.boolean().optional(),
  isElectronic: z.boolean().optional(),
}).strict()

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const { id } = await params
    const body = await request.json()

    // Validar y filtrar campos permitidos
    const validatedData = invoiceNumberingUpdateSchema.parse(body)

    const talonario = await prisma.invoiceNumbering.update({
      where: { id },
      data: validatedData
    })

    return NextResponse.json(talonario)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: error.issues },
        { status: 400 }
      )
    }

    console.error('Error updating talonario:', error)
    return NextResponse.json(
      { error: 'Error al actualizar talonario' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const { id } = await params

    await prisma.invoiceNumbering.delete({
      where: { id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting talonario:', error)
    return NextResponse.json(
      { error: 'Error al eliminar talonario' },
      { status: 500 }
    )
  }
}

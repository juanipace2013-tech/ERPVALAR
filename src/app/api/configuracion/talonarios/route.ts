import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'

const invoiceNumberingSchema = z.object({
  description: z.string().min(1, 'La descripción es obligatoria'),
  prefix: z.string().min(1, 'El prefijo es obligatorio'),
  numberFrom: z.number().int().nonnegative(),
  numberTo: z.number().int().positive(),
  currentNumber: z.number().int().nonnegative(),
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

export async function GET(_request: NextRequest) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const talonarios = await prisma.invoiceNumbering.findMany({
      orderBy: { createdAt: 'asc' }
    })

    return NextResponse.json(talonarios)
  } catch (error) {
    console.error('Error fetching talonarios:', error)
    return NextResponse.json(
      { error: 'Error al obtener talonarios' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const body = await request.json()

    // Validar y filtrar campos permitidos
    const validatedData = invoiceNumberingSchema.parse(body)

    const talonario = await prisma.invoiceNumbering.create({
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

    console.error('Error creating talonario:', error)
    return NextResponse.json(
      { error: 'Error al crear talonario' },
      { status: 500 }
    )
  }
}

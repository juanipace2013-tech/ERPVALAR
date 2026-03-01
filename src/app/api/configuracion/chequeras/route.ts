import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'

const bankCheckbookSchema = z.object({
  bankName: z.string().min(1, 'El nombre del banco es obligatorio'),
  accountNumber: z.string().min(1, 'El número de cuenta es obligatorio'),
  checkFrom: z.number().int().nonnegative(),
  checkTo: z.number().int().positive(),
  currentCheck: z.number().int().nonnegative(),
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

    const chequeras = await prisma.bankCheckbook.findMany({
      include: {
        checks: {
          orderBy: { paymentDate: 'desc' },
          take: 10
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json(chequeras)
  } catch (error) {
    console.error('Error fetching chequeras:', error)
    return NextResponse.json(
      { error: 'Error al obtener chequeras' },
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
    const validatedData = bankCheckbookSchema.parse(body)

    const chequera = await prisma.bankCheckbook.create({
      data: validatedData
    })

    return NextResponse.json(chequera)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: error.issues },
        { status: 400 }
      )
    }

    console.error('Error creating chequera:', error)
    return NextResponse.json(
      { error: 'Error al crear chequera' },
      { status: 500 }
    )
  }
}

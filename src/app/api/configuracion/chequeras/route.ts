import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

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

    const chequera = await prisma.bankCheckbook.create({
      data: body
    })

    return NextResponse.json(chequera)
  } catch (error) {
    console.error('Error creating chequera:', error)
    return NextResponse.json(
      { error: 'Error al crear chequera' },
      { status: 500 }
    )
  }
}

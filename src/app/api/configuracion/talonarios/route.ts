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

    const talonario = await prisma.invoiceNumbering.create({
      data: body
    })

    return NextResponse.json(talonario)
  } catch (error) {
    console.error('Error creating talonario:', error)
    return NextResponse.json(
      { error: 'Error al crear talonario' },
      { status: 500 }
    )
  }
}

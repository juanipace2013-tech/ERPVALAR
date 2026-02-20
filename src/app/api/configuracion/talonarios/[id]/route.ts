import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

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

    const talonario = await prisma.invoiceNumbering.update({
      where: { id },
      data: body
    })

    return NextResponse.json(talonario)
  } catch (error) {
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

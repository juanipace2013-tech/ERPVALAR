import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params

    const search = await prisma.bcraSearchHistory.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true } },
      },
    })

    if (!search) {
      return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 })
    }

    return NextResponse.json(search)
  } catch (error) {
    console.error('Error fetching BCRA search detail:', error)
    return NextResponse.json(
      { error: 'Error al obtener detalle' },
      { status: 500 }
    )
  }
}

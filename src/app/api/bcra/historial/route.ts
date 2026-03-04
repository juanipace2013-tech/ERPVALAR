import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const cuit = searchParams.get('cuit')
    const userId = searchParams.get('userId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const limit = parseInt(searchParams.get('limit') || '50')

    const where: any = {}
    if (cuit) where.cuit = { contains: cuit.replace(/\D/g, '') }
    if (userId && userId !== 'all') where.userId = userId
    if (dateFrom || dateTo) {
      where.searchDate = {}
      if (dateFrom) where.searchDate.gte = new Date(`${dateFrom}T00:00:00`)
      if (dateTo) where.searchDate.lte = new Date(`${dateTo}T23:59:59`)
    }

    const searches = await prisma.bcraSearchHistory.findMany({
      where,
      select: {
        id: true,
        cuit: true,
        customerName: true,
        semaforo: true,
        searchDate: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: { searchDate: 'desc' },
      take: Math.min(limit, 200),
    })

    return NextResponse.json(searches)
  } catch (error) {
    console.error('Error fetching BCRA search history:', error)
    return NextResponse.json(
      { error: 'Error al obtener historial' },
      { status: 500 }
    )
  }
}

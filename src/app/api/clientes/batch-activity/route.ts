import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/clientes/batch-activity
 * Recibe un array de CUITs y retorna la última actividad y cotizaciones activas
 * para cada uno. Usado por la listing page del módulo Clientes.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const cuits: string[] = body.cuits || []

    if (cuits.length === 0) {
      return NextResponse.json({ activity: {} })
    }

    // Buscar todos los clientes locales con esos CUITs
    // Normalizar: buscar tanto con como sin guiones
    const customers = await prisma.customer.findMany({
      where: {
        cuit: { in: cuits },
      },
      select: {
        id: true,
        cuit: true,
        quotes: {
          select: {
            date: true,
            status: true,
          },
          orderBy: { date: 'desc' },
          take: 1,
        },
        deliveryNotes: {
          select: {
            date: true,
          },
          orderBy: { date: 'desc' },
          take: 1,
        },
        invoices: {
          select: {
            issueDate: true,
          },
          orderBy: { issueDate: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            quotes: {
              where: {
                status: { in: ['ACCEPTED', 'SENT', 'DRAFT'] },
              },
            },
          },
        },
      },
    })

    // También buscar CUITs con formato XX-XXXXXXXX-X
    const formattedCuits = cuits.map((c) => {
      const digits = c.replace(/\D/g, '')
      if (digits.length === 11) {
        return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
      }
      return c
    })

    const customersFormatted = await prisma.customer.findMany({
      where: {
        cuit: { in: formattedCuits },
        id: { notIn: customers.map((c) => c.id) }, // Evitar duplicados
      },
      select: {
        id: true,
        cuit: true,
        quotes: {
          select: { date: true, status: true },
          orderBy: { date: 'desc' },
          take: 1,
        },
        deliveryNotes: {
          select: { date: true },
          orderBy: { date: 'desc' },
          take: 1,
        },
        invoices: {
          select: { issueDate: true },
          orderBy: { issueDate: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            quotes: {
              where: { status: { in: ['ACCEPTED', 'SENT', 'DRAFT'] } },
            },
          },
        },
      },
    })

    const allCustomers = [...customers, ...customersFormatted]

    // Armar mapa de actividad
    const activity: Record<
      string,
      { lastActivity: string | null; activeQuotes: number; localId: string | null }
    > = {}

    for (const c of allCustomers) {
      // Normalizar CUIT a solo dígitos para usar como key
      const cuitKey = c.cuit.replace(/\D/g, '')

      // Encontrar la fecha más reciente entre cotizaciones, remitos y facturas
      const dates: Date[] = []
      if (c.quotes[0]?.date) dates.push(new Date(c.quotes[0].date))
      if (c.deliveryNotes[0]?.date) dates.push(new Date(c.deliveryNotes[0].date))
      if (c.invoices[0]?.issueDate) dates.push(new Date(c.invoices[0].issueDate))

      const lastActivity =
        dates.length > 0
          ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString()
          : null

      activity[cuitKey] = {
        lastActivity,
        activeQuotes: c._count.quotes,
        localId: c.id,
      }
    }

    return NextResponse.json({ activity })
  } catch (error: any) {
    console.error('Error fetching batch activity:', error)
    return NextResponse.json(
      { error: error.message || 'Error al obtener actividad', activity: {} },
      { status: 500 }
    )
  }
}

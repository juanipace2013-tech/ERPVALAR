import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/clientes/batch-activity
 * Recibe un array de CUITs (normalizados, solo dígitos) y retorna la última
 * actividad, cotizaciones activas y vendedor asignado para cada uno.
 *
 * Optimizado para manejar 5000+ CUITs: carga todos los clientes locales en
 * una sola query y los matchea por CUIT normalizado.
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

    // Crear Set de CUITs solicitados para filtrar rápido
    const requestedCuits = new Set(cuits.map(c => c.replace(/\D/g, '')))

    // Cargar TODOS los clientes locales con actividad en una sola query
    // (más eficiente que dos queries con IN de 5000+ valores)
    const allCustomers = await prisma.customer.findMany({
      select: {
        id: true,
        cuit: true,
        salesPerson: {
          select: { id: true, name: true, email: true },
        },
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

    // Armar mapa de actividad, solo para CUITs solicitados
    const activity: Record<
      string,
      {
        lastActivity: string | null
        activeQuotes: number
        localId: string | null
        salesPerson: { id: string; name: string; email: string } | null
      }
    > = {}

    for (const c of allCustomers) {
      if (!c.cuit) continue
      const cuitKey = c.cuit.replace(/\D/g, '')
      if (!requestedCuits.has(cuitKey)) continue

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
        salesPerson: c.salesPerson || null,
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

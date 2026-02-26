import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/clientes/by-cuit/[cuit]
 * Busca un cliente en la DB local por CUIT y retorna datos comerciales.
 * Usado por el tab "Comercial" del módulo de Clientes.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ cuit: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { cuit: rawCuit } = await params
    // Normalizar CUIT: quitar todo excepto dígitos
    const normalizedCuit = rawCuit.replace(/\D/g, '')

    if (normalizedCuit.length < 7) {
      return NextResponse.json(
        { error: 'CUIT inválido', found: false },
        { status: 400 }
      )
    }

    // Buscar por CUIT exacto o parcial (el CUIT puede estar guardado con o sin guiones)
    const customer = await prisma.customer.findFirst({
      where: {
        OR: [
          { cuit: normalizedCuit },
          { cuit: `${normalizedCuit.slice(0, 2)}-${normalizedCuit.slice(2, 10)}-${normalizedCuit.slice(10)}` },
          { cuit: { contains: normalizedCuit } },
        ],
      },
      include: {
        salesPerson: {
          select: { id: true, name: true, email: true },
        },
        quotes: {
          select: {
            id: true,
            quoteNumber: true,
            date: true,
            status: true,
            total: true,
            currency: true,
            exchangeRate: true,
          },
          orderBy: { date: 'desc' },
          take: 30,
        },
        deliveryNotes: {
          select: {
            id: true,
            deliveryNumber: true,
            date: true,
            status: true,
            totalAmountARS: true,
          },
          orderBy: { date: 'desc' },
          take: 20,
        },
        invoices: {
          select: {
            id: true,
            invoiceNumber: true,
            invoiceType: true,
            issueDate: true,
            dueDate: true,
            total: true,
            balance: true,
            currency: true,
            status: true,
            paymentStatus: true,
          },
          orderBy: { issueDate: 'desc' },
          take: 20,
        },
        _count: {
          select: {
            quotes: true,
            deliveryNotes: true,
            invoices: true,
          },
        },
      },
    })

    if (!customer) {
      return NextResponse.json({ found: false, customer: null })
    }

    // Calcular stats comerciales
    const totalQuoted = customer.quotes.reduce((sum, q) => sum + Number(q.total), 0)
    const acceptedQuotes = customer.quotes.filter(
      (q) => q.status === 'ACCEPTED' || q.status === 'CONVERTED'
    ).length
    const conversionRate =
      customer.quotes.length > 0
        ? Math.round((acceptedQuotes / customer.quotes.length) * 100)
        : 0

    return NextResponse.json({
      found: true,
      customer: {
        id: customer.id,
        name: customer.name,
        businessName: customer.businessName,
        cuit: customer.cuit,
        salesPerson: customer.salesPerson,
        quotes: customer.quotes,
        deliveryNotes: customer.deliveryNotes,
        invoices: customer.invoices,
        _count: customer._count,
        stats: {
          totalQuoted,
          acceptedQuotes,
          conversionRate,
        },
      },
    })
  } catch (error: any) {
    console.error('Error fetching customer by CUIT:', error)
    return NextResponse.json(
      { error: error.message || 'Error al buscar cliente', found: false },
      { status: 500 }
    )
  }
}

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'


import { prisma } from '@/lib/prisma'

// GET /api/cobros/facturas-pendientes?customerId=xxx
// Retorna facturas del cliente con saldo pendiente para el formulario de cobros
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const customerId = searchParams.get('customerId')

    if (!customerId) {
      return NextResponse.json({ error: 'customerId es requerido' }, { status: 400 })
    }

    // Verificar que el cliente existe
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, name: true, cuit: true }
    })
    if (!customer) {
      return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
    }

    // Facturas en estados que admiten cobro
    const invoices = await prisma.invoice.findMany({
      where: {
        customerId,
        status: { in: ['AUTHORIZED', 'SENT', 'OVERDUE'] },
      },
      select: {
        id:            true,
        invoiceNumber: true,
        invoiceType:   true,
        issueDate:     true,
        dueDate:       true,
        total:         true,
        paidAmount:    true,
        currency:      true,
        exchangeRate:  true,
        status:        true,
      },
      orderBy: { dueDate: 'asc' }
    })

    // Filtrar en memoria las que tienen saldo pendiente > 0.01
    const withBalance = invoices
      .map((inv) => ({
        ...inv,
        total:            Number(inv.total),
        paidAmount:       Number(inv.paidAmount),
        remainingBalance: Number(inv.total) - Number(inv.paidAmount),
      }))
      .filter((inv) => inv.remainingBalance > 0.01)

    return NextResponse.json({ customer, invoices: withBalance })
  } catch (error) {
    console.error('[GET /api/cobros/facturas-pendientes]', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

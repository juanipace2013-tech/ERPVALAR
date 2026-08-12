import { logger } from '@/lib/logger'
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

// GET /api/clientes/[id]/movimientos - Obtener movimientos de cuenta del cliente
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const customerId = id

    // Verificar que el cliente existe
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, name: true, balance: true },
    })

    if (!customer) {
      return NextResponse.json(
        { error: 'Cliente no encontrado' },
        { status: 404 }
      )
    }

    // Obtener todas las facturas del cliente. select con SOLO los campos que
    // usa el mapeo de abajo: el modelo Invoice completo tiene ~45 columnas
    // (incluyendo campos Text de AFIP/notas) y esta query trae el histórico entero.
    const invoices = await prisma.invoice.findMany({
      where: { customerId },
      orderBy: { issueDate: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceType: true,
        issueDate: true,
        dueDate: true,
        paidDate: true,
        status: true,
        currency: true,
        total: true,
        items: {
          select: {
            quantity: true,
            unitPrice: true,
            subtotal: true,
            product: {
              select: {
                name: true,
              },
            },
          },
        },
        user: {
          select: {
            name: true,
          },
        },
      },
    })

    // Transformar facturas a movimientos con balance acumulado
    let runningBalance = 0
    const movements = invoices.map((invoice) => {
      const amount = Number(invoice.total)

      // Para facturas autorizadas/enviadas/pendientes, se suma al balance
      // Para facturas pagadas, no afectan el balance pendiente
      if (invoice.status !== 'PAID' && invoice.status !== 'DRAFT') {
        runningBalance += amount
      }

      return {
        id: invoice.id,
        type: 'INVOICE' as const,
        date: invoice.issueDate,
        reference: invoice.invoiceNumber,
        invoiceType: invoice.invoiceType,
        description: `Factura ${invoice.invoiceType} ${invoice.invoiceNumber}`,
        status: invoice.status,
        currency: invoice.currency,
        debit: amount, // Las facturas son débitos (aumentan deuda)
        credit: 0,
        balance: runningBalance,
        dueDate: invoice.dueDate,
        paidDate: invoice.paidDate,
        items: invoice.items.map((item) => ({
          product: item.product?.name,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          subtotal: Number(item.subtotal),
        })),
        user: invoice.user.name,
      }
    })

    // Calcular balance actual (debería coincidir con customer.balance)
    const currentBalance = (movements || [])
      .filter((m) => m.status !== 'PAID' && m.status !== 'DRAFT')
      .reduce((sum, m) => sum + m.debit - m.credit, 0)

    // Estadísticas
    const safeInvoices = invoices || []
    const stats = {
      totalInvoices: safeInvoices.length,
      pendingInvoices: safeInvoices.filter(
        (i) => i.status === 'PENDING' || i.status === 'AUTHORIZED' || i.status === 'SENT'
      ).length,
      paidInvoices: safeInvoices.filter((i) => i.status === 'PAID').length,
      overdueInvoices: safeInvoices.filter(
        (i) =>
          (i.status === 'PENDING' || i.status === 'AUTHORIZED' || i.status === 'SENT') &&
          new Date(i.dueDate) < new Date()
      ).length,
      totalDebt: currentBalance,
      totalInvoiced: safeInvoices
        .filter((i) => i.status !== 'DRAFT')
        .reduce((sum, i) => sum + Number(i.total), 0),
      totalPaid: safeInvoices
        .filter((i) => i.status === 'PAID')
        .reduce((sum, i) => sum + Number(i.total), 0),
    }

    return NextResponse.json({
      customer: {
        id: customer.id,
        name: customer.name,
        balance: Number(customer.balance),
      },
      movements,
      stats,
    })
  } catch (error) {
    logger.error('Error fetching customer movements:', error)
    return NextResponse.json(
      { error: 'Error al obtener movimientos' },
      { status: 500 }
    )
  }
}

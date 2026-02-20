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

    // Obtener todos los clientes
    const customers = await prisma.customer.findMany({
      include: {
        _count: {
          select: {
            quotes: true,
            invoices: true,
          },
        },
        salesPerson: {
          select: {
            name: true,
          },
        },
        invoices: {
          orderBy: {
            issueDate: 'desc',
          },
          take: 1,
          select: {
            issueDate: true,
          },
        },
      },
    })

    // Calcular estadísticas
    const totalCustomers = customers.length
    const activeCustomers = customers.filter((c) => c.status === 'ACTIVE').length
    const inactiveCustomers = customers.filter((c) => c.status === 'INACTIVE').length

    // Clientes nuevos este mes
    const firstDayOfMonth = new Date()
    firstDayOfMonth.setDate(1)
    firstDayOfMonth.setHours(0, 0, 0, 0)

    const newThisMonth = customers.filter(
      (c) => new Date(c.createdAt) >= firstDayOfMonth
    ).length

    // Saldos
    const totalBalance = customers.reduce(
      (sum, c) => sum + parseFloat(c.balance.toString()),
      0
    )
    const averageBalance = totalCustomers > 0 ? totalBalance / totalCustomers : 0

    // Total de cotizaciones y facturas
    const totalQuotes = customers.reduce((sum, c) => sum + c._count.quotes, 0)
    const totalInvoices = customers.reduce((sum, c) => sum + c._count.invoices, 0)

    // Top clientes por saldo
    const topCustomers = customers
      .filter((c) => parseFloat(c.balance.toString()) > 0)
      .sort((a, b) => parseFloat(b.balance.toString()) - parseFloat(a.balance.toString()))
      .slice(0, 10)
      .map((c) => ({
        id: c.id,
        name: c.name,
        balance: parseFloat(c.balance.toString()),
        invoices: c._count.invoices,
        quotes: c._count.quotes,
      }))

    // Clientes por vendedor
    const customersBySalesPerson: Record<
      string,
      { count: number; totalBalance: number }
    > = {}

    customers.forEach((c) => {
      const salesPersonName = c.salesPerson?.name || 'Sin asignar'
      if (!customersBySalesPerson[salesPersonName]) {
        customersBySalesPerson[salesPersonName] = { count: 0, totalBalance: 0 }
      }
      customersBySalesPerson[salesPersonName].count++
      customersBySalesPerson[salesPersonName].totalBalance += parseFloat(
        c.balance.toString()
      )
    })

    const customersBySalesPersonArray = Object.entries(customersBySalesPerson)
      .map(([salesperson, data]) => ({
        salesperson,
        count: data.count,
        totalBalance: data.totalBalance,
      }))
      .sort((a, b) => b.count - a.count)

    // Clientes con deuda (saldo > 0)
    const customersWithDebt = customers
      .filter((c) => parseFloat(c.balance.toString()) > 0)
      .sort((a, b) => parseFloat(b.balance.toString()) - parseFloat(a.balance.toString()))
      .slice(0, 20)
      .map((c) => ({
        id: c.id,
        name: c.name,
        balance: parseFloat(c.balance.toString()),
        lastInvoiceDate: c.invoices[0]?.issueDate.toISOString() || null,
      }))

    const summary = {
      totalCustomers,
      activeCustomers,
      inactiveCustomers,
      newThisMonth,
      totalBalance,
      averageBalance,
      totalQuotes,
      totalInvoices,
      topCustomers,
      customersBySalesPerson: customersBySalesPersonArray,
      customersWithDebt,
    }

    return NextResponse.json(summary)
  } catch (error) {
    console.error('Error fetching customer summary:', error)
    return NextResponse.json(
      { error: 'Error al obtener resumen de clientes' },
      { status: 500 }
    )
  }
}

import { prisma } from './prisma'
import { startOfMonth, endOfMonth, subMonths, format, startOfWeek, endOfWeek, subWeeks, startOfDay, endOfDay, subDays } from 'date-fns'
import { es } from 'date-fns/locale'

export type PeriodType = 'daily' | 'weekly' | 'monthly'

export interface DashboardMetrics {
  salesThisMonth: number
  salesChange: number
  purchasesThisMonth: number
  purchasesChange: number
  invoicesToCollect: number
  invoicesToPay: number
}

export interface CashFlowMonth {
  month: string
  income: number
  expense: number
  balance: number
}

export interface ExpenseCategory {
  category: string
  amount: number
  percentage: number
}

/**
 * Obtener métricas principales del dashboard
 */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const now = new Date()
  const startThisMonth = startOfMonth(now)
  const endThisMonth = endOfMonth(now)
  const startLastMonth = startOfMonth(subMonths(now, 1))
  const endLastMonth = endOfMonth(subMonths(now, 1))

  // Total ventas del mes actual (todas las facturas son de venta)
  const salesThisMonth = await prisma.invoice.aggregate({
    where: {
      issueDate: {
        gte: startThisMonth,
        lte: endThisMonth
      },
      status: {
        in: ['AUTHORIZED', 'SENT', 'PAID']
      }
    },
    _sum: {
      total: true
    }
  })

  // Total ventas del mes anterior
  const salesLastMonth = await prisma.invoice.aggregate({
    where: {
      issueDate: {
        gte: startLastMonth,
        lte: endLastMonth
      },
      status: {
        in: ['AUTHORIZED', 'SENT', 'PAID']
      }
    },
    _sum: {
      total: true
    }
  })

  // Facturas por cobrar: sum(total - paidAmount) de facturas no pagadas
  const pendingInvoices = await prisma.invoice.aggregate({
    where: {
      status: {
        in: ['AUTHORIZED', 'SENT', 'OVERDUE']
      }
    },
    _sum: {
      total: true,
      paidAmount: true
    }
  })

  const invoicesToCollect =
    Number(pendingInvoices._sum.total || 0) - Number(pendingInvoices._sum.paidAmount || 0)

  // Calcular variaciones
  const salesChangeValue =
    salesLastMonth._sum.total && Number(salesLastMonth._sum.total) > 0
      ? ((Number(salesThisMonth._sum.total || 0) - Number(salesLastMonth._sum.total)) /
          Number(salesLastMonth._sum.total)) *
        100
      : 0

  return {
    salesThisMonth: Number(salesThisMonth._sum.total || 0),
    salesChange: salesChangeValue,
    purchasesThisMonth: 0, // Sin módulo de compras implementado aún
    purchasesChange: 0,
    invoicesToCollect,
    invoicesToPay: 0 // Sin módulo de compras implementado aún
  }
}

/**
 * Obtener datos de flujo de caja (últimos 12 meses)
 */
export async function getCashFlowData(): Promise<CashFlowMonth[]> {
  const months: CashFlowMonth[] = []
  let cumulativeBalance = 0

  for (let i = 11; i >= 0; i--) {
    const monthStart = startOfMonth(subMonths(new Date(), i))
    const monthEnd = endOfMonth(subMonths(new Date(), i))

    // Ingresos del mes (ventas cobradas)
    const income = await prisma.invoice.aggregate({
      where: {
        status: 'PAID',
        paidDate: { gte: monthStart, lte: monthEnd }
      },
      _sum: { total: true }
    })

    const monthIncome = Number(income._sum.total || 0)
    cumulativeBalance += monthIncome

    months.push({
      month: format(monthStart, 'MMM', { locale: es }),
      income: monthIncome,
      expense: 0, // Sin módulo de compras
      balance: cumulativeBalance
    })
  }

  return months
}

/**
 * Obtener datos de ingresos y gastos (últimos 12 meses)
 */
export async function getIncomeExpenseData(): Promise<CashFlowMonth[]> {
  const months: CashFlowMonth[] = []
  let cumulativeBalance = 0

  for (let i = 11; i >= 0; i--) {
    const monthStart = startOfMonth(subMonths(new Date(), i))
    const monthEnd = endOfMonth(subMonths(new Date(), i))

    // Ingresos del mes (todas las ventas autorizadas)
    const income = await prisma.invoice.aggregate({
      where: {
        issueDate: { gte: monthStart, lte: monthEnd },
        status: { in: ['AUTHORIZED', 'SENT', 'PAID'] }
      },
      _sum: { total: true }
    })

    const monthIncome = Number(income._sum.total || 0)
    cumulativeBalance += monthIncome

    months.push({
      month: format(monthStart, 'MMM', { locale: es }),
      income: monthIncome,
      expense: 0, // Sin módulo de compras
      balance: cumulativeBalance
    })
  }

  return months
}

/**
 * Obtener datos de facturas por cobrar (últimas 4 semanas)
 */
export async function getInvoicesToCollectWeekly(): Promise<CashFlowMonth[]> {
  const weeks: CashFlowMonth[] = []
  let cumulativeBalance = 0

  for (let i = 3; i >= 0; i--) {
    const weekStart = startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 })
    const weekEnd = endOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 })

    const sales = await prisma.invoice.aggregate({
      where: {
        issueDate: { gte: weekStart, lte: weekEnd },
        status: { in: ['AUTHORIZED', 'SENT', 'PAID'] }
      },
      _sum: { total: true }
    })

    const weekTotal = Number(sales._sum.total || 0)
    cumulativeBalance += weekTotal

    weeks.push({
      month: `S${4 - i}`,
      income: weekTotal,
      expense: 0,
      balance: cumulativeBalance
    })
  }

  return weeks
}

/**
 * Obtener distribución de ventas del mes actual por categoría de producto
 */
export async function getExpenseDistribution(): Promise<ExpenseCategory[]> {
  const startThisMonth = startOfMonth(new Date())
  const endThisMonth = endOfMonth(new Date())

  // Obtener todas las facturas del mes con sus items
  const invoices = await prisma.invoice.findMany({
    where: {
      issueDate: { gte: startThisMonth, lte: endThisMonth },
      status: { in: ['AUTHORIZED', 'SENT', 'PAID'] }
    },
    include: {
      items: {
        include: {
          product: {
            include: {
              category: true
            }
          }
        }
      }
    }
  })

  // Agrupar por categoría
  const categoryTotals = new Map<string, number>()

  invoices.forEach(invoice => {
    invoice.items.forEach(item => {
      const categoryName = item.product.category?.name || 'Sin categoría'
      const itemTotal = Number(item.subtotal)

      categoryTotals.set(
        categoryName,
        (categoryTotals.get(categoryName) || 0) + itemTotal
      )
    })
  })

  // Convertir a array y calcular porcentajes
  const total = Array.from(categoryTotals.values()).reduce((sum, val) => sum + val, 0)

  const categories: ExpenseCategory[] = Array.from(categoryTotals.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: total > 0 ? (amount / total) * 100 : 0
    }))
    .sort((a, b) => b.amount - a.amount)

  return categories
}

/**
 * Obtener datos de flujo de caja con período configurable
 */
export async function getCashFlowDataByPeriod(period: PeriodType = 'monthly'): Promise<CashFlowMonth[]> {
  const data: CashFlowMonth[] = []
  let cumulativeBalance = 0

  if (period === 'daily') {
    // Últimos 30 días
    for (let i = 29; i >= 0; i--) {
      const dayStart = startOfDay(subDays(new Date(), i))
      const dayEnd = endOfDay(subDays(new Date(), i))

      const income = await prisma.invoice.aggregate({
        where: {
          status: 'PAID',
          paidDate: { gte: dayStart, lte: dayEnd }
        },
        _sum: { total: true }
      })

      const dayIncome = Number(income._sum.total || 0)
      cumulativeBalance += dayIncome

      data.push({
        month: format(dayStart, 'dd/MM', { locale: es }),
        income: dayIncome,
        expense: 0,
        balance: cumulativeBalance
      })
    }
  } else if (period === 'weekly') {
    // Últimas 12 semanas
    for (let i = 11; i >= 0; i--) {
      const weekStart = startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 })
      const weekEnd = endOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 })

      const income = await prisma.invoice.aggregate({
        where: {
          status: 'PAID',
          paidDate: { gte: weekStart, lte: weekEnd }
        },
        _sum: { total: true }
      })

      const weekIncome = Number(income._sum.total || 0)
      cumulativeBalance += weekIncome

      data.push({
        month: `S${12 - i}`,
        income: weekIncome,
        expense: 0,
        balance: cumulativeBalance
      })
    }
  } else {
    // Mensual (por defecto) - últimos 12 meses
    return getCashFlowData()
  }

  return data
}

/**
 * Obtener datos de ingresos y gastos con período configurable
 */
export async function getIncomeExpenseDataByPeriod(period: PeriodType = 'monthly'): Promise<CashFlowMonth[]> {
  const data: CashFlowMonth[] = []
  let cumulativeBalance = 0

  if (period === 'daily') {
    // Últimos 30 días
    for (let i = 29; i >= 0; i--) {
      const dayStart = startOfDay(subDays(new Date(), i))
      const dayEnd = endOfDay(subDays(new Date(), i))

      const income = await prisma.invoice.aggregate({
        where: {
          issueDate: { gte: dayStart, lte: dayEnd },
          status: { in: ['AUTHORIZED', 'SENT', 'PAID'] }
        },
        _sum: { total: true }
      })

      const dayIncome = Number(income._sum.total || 0)
      cumulativeBalance += dayIncome

      data.push({
        month: format(dayStart, 'dd/MM', { locale: es }),
        income: dayIncome,
        expense: 0,
        balance: cumulativeBalance
      })
    }
  } else if (period === 'weekly') {
    // Últimas 12 semanas
    for (let i = 11; i >= 0; i--) {
      const weekStart = startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 })
      const weekEnd = endOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 })

      const income = await prisma.invoice.aggregate({
        where: {
          issueDate: { gte: weekStart, lte: weekEnd },
          status: { in: ['AUTHORIZED', 'SENT', 'PAID'] }
        },
        _sum: { total: true }
      })

      const weekIncome = Number(income._sum.total || 0)
      cumulativeBalance += weekIncome

      data.push({
        month: `S${12 - i}`,
        income: weekIncome,
        expense: 0,
        balance: cumulativeBalance
      })
    }
  } else {
    // Mensual (por defecto) - últimos 12 meses
    return getIncomeExpenseData()
  }

  return data
}

/**
 * Obtener datos de facturas por cobrar o por pagar con período configurable
 */
export async function getInvoicesData(
  type: 'collect' | 'pay' = 'collect',
  period: PeriodType = 'weekly'
): Promise<CashFlowMonth[]> {
  // Sin módulo de compras, 'pay' siempre retorna vacío
  if (type === 'pay') {
    const emptyData: CashFlowMonth[] = []
    if (period === 'daily') {
      for (let i = 29; i >= 0; i--) {
        emptyData.push({ month: format(subDays(new Date(), i), 'dd/MM', { locale: es }), income: 0, expense: 0, balance: 0 })
      }
    } else if (period === 'monthly') {
      for (let i = 11; i >= 0; i--) {
        emptyData.push({ month: format(startOfMonth(subMonths(new Date(), i)), 'MMM', { locale: es }), income: 0, expense: 0, balance: 0 })
      }
    } else {
      for (let i = 3; i >= 0; i--) {
        emptyData.push({ month: `S${4 - i}`, income: 0, expense: 0, balance: 0 })
      }
    }
    return emptyData
  }

  const data: CashFlowMonth[] = []
  let cumulativeBalance = 0

  if (period === 'daily') {
    for (let i = 29; i >= 0; i--) {
      const dayStart = startOfDay(subDays(new Date(), i))
      const dayEnd = endOfDay(subDays(new Date(), i))

      const invoices = await prisma.invoice.aggregate({
        where: {
          issueDate: { gte: dayStart, lte: dayEnd },
          status: { in: ['AUTHORIZED', 'SENT', 'PAID'] }
        },
        _sum: { total: true }
      })

      const total = Number(invoices._sum.total || 0)
      cumulativeBalance += total

      data.push({
        month: format(dayStart, 'dd/MM', { locale: es }),
        income: total,
        expense: 0,
        balance: cumulativeBalance
      })
    }
  } else if (period === 'monthly') {
    for (let i = 11; i >= 0; i--) {
      const monthStart = startOfMonth(subMonths(new Date(), i))
      const monthEnd = endOfMonth(subMonths(new Date(), i))

      const invoices = await prisma.invoice.aggregate({
        where: {
          issueDate: { gte: monthStart, lte: monthEnd },
          status: { in: ['AUTHORIZED', 'SENT', 'PAID'] }
        },
        _sum: { total: true }
      })

      const total = Number(invoices._sum.total || 0)
      cumulativeBalance += total

      data.push({
        month: format(monthStart, 'MMM', { locale: es }),
        income: total,
        expense: 0,
        balance: cumulativeBalance
      })
    }
  } else {
    // Semanal (por defecto) - últimas 4 semanas
    for (let i = 3; i >= 0; i--) {
      const weekStart = startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 })
      const weekEnd = endOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 })

      const invoices = await prisma.invoice.aggregate({
        where: {
          issueDate: { gte: weekStart, lte: weekEnd },
          status: { in: ['AUTHORIZED', 'SENT', 'PAID'] }
        },
        _sum: { total: true }
      })

      const total = Number(invoices._sum.total || 0)
      cumulativeBalance += total

      data.push({
        month: `S${4 - i}`,
        income: total,
        expense: 0,
        balance: cumulativeBalance
      })
    }
  }

  return data
}

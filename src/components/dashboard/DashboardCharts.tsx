'use client'

import { useState, useCallback } from 'react'
import { EnhancedBarChart } from './EnhancedBarChart'
import { EnhancedDonutChart } from './EnhancedDonutChart'

interface ChartData {
  month: string
  income: number
  expense: number
  balance: number
}

interface ExpenseData {
  category: string
  amount: number
  percentage: number
}

interface DashboardChartsProps {
  initialCashFlowData: ChartData[]
  initialIncomeExpenseData: ChartData[]
  initialInvoicesData: ChartData[]
  initialExpenseDistribution: ExpenseData[]
}

export function DashboardCharts({
  initialCashFlowData,
  initialIncomeExpenseData,
  initialInvoicesData,
  initialExpenseDistribution
}: DashboardChartsProps) {
  const [cashFlowData, setCashFlowData] = useState(initialCashFlowData)
  const [incomeExpenseData, setIncomeExpenseData] = useState(initialIncomeExpenseData)
  const [invoicesData, setInvoicesData] = useState(initialInvoicesData)
  const [expenseDistribution, setExpenseDistribution] = useState(initialExpenseDistribution)

  const refreshCashFlow = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard?chart=cashflow&period=monthly')
      if (response.ok) {
        const data = await response.json()
        setCashFlowData(data)
      }
    } catch (error) {
      console.error('Error refreshing cash flow:', error)
    }
  }, [])

  const refreshIncomeExpense = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard?chart=income-expense&period=monthly')
      if (response.ok) {
        const data = await response.json()
        setIncomeExpenseData(data)
      }
    } catch (error) {
      console.error('Error refreshing income expense:', error)
    }
  }, [])

  const refreshInvoices = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard?chart=invoices&type=collect&period=weekly')
      if (response.ok) {
        const data = await response.json()
        setInvoicesData(data)
      }
    } catch (error) {
      console.error('Error refreshing invoices:', error)
    }
  }, [])

  const refreshExpenses = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard?chart=expenses')
      if (response.ok) {
        const data = await response.json()
        setExpenseDistribution(data)
      }
    } catch (error) {
      console.error('Error refreshing expenses:', error)
    }
  }, [])

  return (
    <>
      {/* Gráficos - Primera fila */}
      <div className="grid gap-6 md:grid-cols-2">
        <EnhancedBarChart
          title="Cajas y bancos"
          data={cashFlowData}
          tooltipText="Flujo de caja mensual basado en pagos efectivos"
          incomeLabel="Ingresos"
          expenseLabel="Egresos"
          balanceLabel="Saldo"
          onRefresh={refreshCashFlow}
        />
        <EnhancedBarChart
          title="Ingresos y gastos"
          data={incomeExpenseData}
          tooltipText="Ingresos y gastos mensuales basados en facturación"
          incomeLabel="Ingresos"
          expenseLabel="Gastos"
          balanceLabel="Saldo"
          onRefresh={refreshIncomeExpense}
        />
      </div>

      {/* Gráficos - Segunda fila */}
      <div className="grid gap-6 md:grid-cols-2">
        <EnhancedBarChart
          title="Facturas - Por cobrar"
          data={invoicesData}
          tooltipText="Facturas de venta emitidas por semana"
          incomeLabel="Vendido"
          expenseLabel=""
          balanceLabel="Acumulado"
          onRefresh={refreshInvoices}
        />
        <EnhancedDonutChart
          title="Distribución de gastos"
          data={expenseDistribution}
          tooltipText="Gastos del mes actual agrupados por categoría"
          onRefresh={refreshExpenses}
        />
      </div>
    </>
  )
}

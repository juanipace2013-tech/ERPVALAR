'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface ChartData {
  month: string
  monthLabel: string
  income: number
  expense: number
  balance: number
}

interface CashFlowChartProps {
  accountId: string
}

export function CashFlowChart({ accountId }: CashFlowChartProps) {
  const [data, setData] = useState<ChartData[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly')

  useEffect(() => {
    loadChartData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, period])

  const loadChartData = async () => {
    try {
      setLoading(true)
      const response = await fetch(
        `/api/tesoreria/cuentas/${accountId}/grafico?period=${period}`
      )
      if (response.ok) {
        const chartData = await response.json()
        setData(chartData)
      }
    } catch (error) {
      console.error('Error loading chart data:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: number) => {
    return `$${(value / 1000).toFixed(0)}K`
  }

  const formatCurrencyFull = (value: number) => {
    return `$${value.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`
  }

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-4 rounded-lg shadow-lg border border-gray-200">
          <p className="font-semibold text-gray-900 mb-2">{label}</p>
          {payload.map((entry: { name: string; value: number; color: string }, index: number) => (
            <div key={index} className="flex items-center gap-2 text-sm">
              <div
                className="w-3 h-3 rounded"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-gray-600">{entry.name}:</span>
              <span className="font-semibold">{formatCurrencyFull(entry.value)}</span>
            </div>
          ))}
        </div>
      )
    }
    return null
  }

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-gray-500">No hay datos para mostrar</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="monthLabel"
            stroke="#6b7280"
            style={{ fontSize: '12px' }}
          />
          <YAxis
            stroke="#6b7280"
            style={{ fontSize: '12px' }}
            tickFormatter={formatCurrency}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            verticalAlign="top"
            height={36}
            iconType="square"
            formatter={(value) => {
              const labels: Record<string, string> = {
                income: 'Total ingresos',
                expense: 'Total egresos',
                balance: 'Saldo',
              }
              return labels[value] || value
            }}
          />
          <Area
            type="monotone"
            dataKey="income"
            name="income"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#colorIncome)"
          />
          <Area
            type="monotone"
            dataKey="expense"
            name="expense"
            stroke="#f59e0b"
            strokeWidth={2}
            fill="url(#colorExpense)"
          />
          <Line
            type="monotone"
            dataKey="balance"
            name="balance"
            stroke="#6b7280"
            strokeWidth={3}
            dot={{ fill: '#6b7280', r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant={period === 'monthly' ? 'default' : 'outline'}
          onClick={() => setPeriod('monthly')}
        >
          Mensual
        </Button>
        <Button
          size="sm"
          variant={period === 'quarterly' ? 'default' : 'outline'}
          onClick={() => setPeriod('quarterly')}
        >
          Trimestral
        </Button>
        <Button
          size="sm"
          variant={period === 'yearly' ? 'default' : 'outline'}
          onClick={() => setPeriod('yearly')}
        >
          Anual
        </Button>
      </div>
    </div>
  )
}

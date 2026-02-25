'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Info, Loader2 } from 'lucide-react'
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface ChartData {
  month: string
  income: number
  expense: number
  balance: number
}

interface InteractiveBarChartProps {
  title: string
  chartType: 'cashflow' | 'income-expense'
  tooltipText?: string
  incomeLabel?: string
  expenseLabel?: string
  balanceLabel?: string
  defaultPeriod?: 'daily' | 'weekly' | 'monthly'
}

export function InteractiveBarChart({
  title,
  chartType,
  tooltipText,
  incomeLabel = 'Ingresos',
  expenseLabel = 'Egresos',
  balanceLabel = 'Saldo',
  defaultPeriod = 'monthly'
}: InteractiveBarChartProps) {
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>(defaultPeriod)
  const [data, setData] = useState<ChartData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, chartType])

  const fetchData = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/dashboard?chart=${chartType}&period=${period}`)
      if (response.ok) {
        const result = await response.json()
        setData(result)
      }
    } catch (error) {
      console.error('Error fetching chart data:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`
    }
    return `$${value.toFixed(0)}`
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          {title}
          {tooltipText && (
            <TooltipProvider>
              <UITooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{tooltipText}</p>
                </TooltipContent>
              </UITooltip>
            </TooltipProvider>
          )}
        </CardTitle>
        <Select value={period} onValueChange={(value) => setPeriod(value as 'daily' | 'weekly' | 'monthly')}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Período" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Diario</SelectItem>
            <SelectItem value="weekly">Semanal</SelectItem>
            <SelectItem value="monthly">Mensual</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-[300px] flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 12 }}
                stroke="#6b7280"
              />
              <YAxis
                tick={{ fontSize: 12 }}
                stroke="#6b7280"
                tickFormatter={formatCurrency}
              />
              <Tooltip
                formatter={(value) => formatCurrency(Number(value ?? 0))}
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px'
                }}
              />
              <Legend
                wrapperStyle={{ paddingTop: '20px' }}
                iconType="circle"
              />
              <Bar
                dataKey="income"
                name={incomeLabel}
                fill="#8b5cf6"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="expense"
                name={expenseLabel}
                fill="#d1d5db"
                radius={[4, 4, 0, 0]}
              />
              <Line
                type="monotone"
                dataKey="balance"
                name={balanceLabel}
                stroke="#6b7280"
                strokeWidth={2}
                dot={{ fill: '#6b7280', r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

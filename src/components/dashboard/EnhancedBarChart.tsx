'use client'

import { useRef, useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { Info, RefreshCw, Download } from 'lucide-react'
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import html2canvas from 'html2canvas'

interface ChartData {
  month: string
  income: number
  expense: number
  balance: number
}

interface EnhancedBarChartProps {
  title: string
  data: ChartData[]
  tooltipText?: string
  incomeLabel?: string
  expenseLabel?: string
  balanceLabel?: string
  onRefresh?: () => Promise<void>
  autoRefresh?: boolean
  refreshInterval?: number // en segundos
}

export function EnhancedBarChart({
  title,
  data: initialData,
  tooltipText,
  incomeLabel = 'Ingresos',
  expenseLabel = 'Egresos',
  balanceLabel = 'Saldo',
  onRefresh,
  autoRefresh = false,
  refreshInterval = 30
}: EnhancedBarChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState(initialData)
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    setData(initialData)
  }, [initialData])

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh || !onRefresh) return

    const interval = setInterval(async () => {
      await handleRefresh()
    }, refreshInterval * 1000)

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, refreshInterval, onRefresh])

  const handleRefresh = async () => {
    if (!onRefresh) return

    try {
      setRefreshing(true)
      await onRefresh()
    } catch (error) {
      console.error('Error refreshing:', error)
    } finally {
      setRefreshing(false)
    }
  }

  const handleExport = async () => {
    if (!chartRef.current) return

    try {
      setExporting(true)

      const canvas = await html2canvas(chartRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
      })

      const link = document.createElement('a')
      link.download = `${title.replace(/\s+/g, '-').toLowerCase()}-${new Date().getTime()}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch (error) {
      console.error('Error exporting chart:', error)
    } finally {
      setExporting(false)
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
    <Card ref={chartRef}>
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
        <div className="flex gap-2">
          {onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              className="h-8 w-8 p-0"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExport}
            disabled={exporting}
            className="h-8 w-8 p-0"
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
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
              formatter={(value: number) => formatCurrency(value)}
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
      </CardContent>
    </Card>
  )
}

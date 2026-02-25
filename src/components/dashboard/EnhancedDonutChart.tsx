'use client'

import { useRef, useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { Info, ChevronLeft, ChevronRight, RefreshCw, Download } from 'lucide-react'
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import html2canvas from 'html2canvas'
import { formatNumber } from '@/lib/utils'

interface ExpenseData {
  category: string
  amount: number
  percentage: number
}

interface EnhancedDonutChartProps {
  title: string
  data: ExpenseData[]
  tooltipText?: string
  onRefresh?: () => Promise<void>
  autoRefresh?: boolean
  refreshInterval?: number
}

const COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#6b7280']
const ITEMS_PER_PAGE = 4

export function EnhancedDonutChart({
  title,
  data: initialData,
  tooltipText,
  onRefresh,
  autoRefresh = false,
  refreshInterval = 30
}: EnhancedDonutChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState(initialData)
  const [currentPage, setCurrentPage] = useState(0)
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

  const totalAmount = data.reduce((sum, item) => sum + item.amount, 0)
  const totalPages = Math.ceil(data.length / ITEMS_PER_PAGE)
  const paginatedData = data.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  )

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `${formatNumber(value / 1000000, 1)}M`
    } else if (value >= 1000) {
      return `${formatNumber(value / 1000, 0)}K`
    }
    return formatNumber(value, 0)
  }

  const CustomLabel = ({ cx, cy }: { cx: number; cy: number }) => {
    return (
      <text
        x={cx}
        y={cy}
        fill="#1f2937"
        textAnchor="middle"
        dominantBaseline="middle"
        className="font-bold"
      >
        <tspan x={cx} dy="-0.5em" fontSize="20">
          ${formatCurrency(totalAmount)}
        </tspan>
        <tspan x={cx} dy="1.5em" fontSize="12" fill="#6b7280">
          Total
        </tspan>
      </text>
    )
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
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={2}
              dataKey="amount"
              label={CustomLabel}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number) => `$${formatCurrency(value)}`}
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '6px'
              }}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Legend with pagination */}
        <div className="mt-4 space-y-2">
          {paginatedData.map((item, index) => {
            const globalIndex = currentPage * ITEMS_PER_PAGE + index
            return (
              <div key={item.category} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: COLORS[globalIndex % COLORS.length] }}
                  />
                  <span className="text-gray-700 truncate max-w-[150px]">
                    {item.category}
                  </span>
                </div>
                <span className="font-medium text-gray-900">
                  {formatNumber(item.percentage)}%
                </span>
              </div>
            )
          })}
        </div>

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-gray-600">
              {currentPage + 1} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
              disabled={currentPage === totalPages - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

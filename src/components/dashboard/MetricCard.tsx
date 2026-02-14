import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LucideIcon } from 'lucide-react'

interface MetricCardProps {
  title: string
  value: string | number
  description?: string
  icon: LucideIcon
  iconColor?: string
  trend?: {
    value: number
    isPositive: boolean
  }
}

export function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  iconColor = 'text-blue-600',
  trend,
}: MetricCardProps) {
  return (
    <Card className="hover:shadow-lg transition-all duration-300 border-blue-100 bg-gradient-to-br from-white to-blue-50/30">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-gray-700">
          {title}
        </CardTitle>
        <div className="p-2 bg-white rounded-lg shadow-sm">
          <Icon className={`h-5 w-5 ${iconColor}`} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        {description && (
          <p className="text-xs text-gray-600 mt-1">{description}</p>
        )}
        {trend && (
          <div className="flex items-center mt-2">
            <span
              className={`text-xs font-medium ${
                trend.isPositive ? 'text-emerald-600' : 'text-red-600'
              }`}
            >
              {trend.isPositive ? '+' : '-'}
              {Math.abs(trend.value)}%
            </span>
            <span className="text-xs text-gray-600 ml-1">vs. mes anterior</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

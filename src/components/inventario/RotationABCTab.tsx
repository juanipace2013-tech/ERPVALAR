'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, BarChart3 } from 'lucide-react'
import { toast } from 'sonner'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Line,
  ResponsiveContainer, ComposedChart,
} from 'recharts'

interface RotationProduct {
  productId: string; sku: string; name: string; brand: string | null
  supplierName: string | null; currentStock: number; minStock: number
  purchaseCount: number; totalQtyPurchased: number; totalValuePurchased: number
  avgQtyPerPurchase: number; avgDaysBetweenPurchases: number
  daysSinceLastPurchase: number; abcCategory: 'A' | 'B' | 'C'
  cumulativeValuePercent: number; estimatedDaysUntilStockout: number
  suggestedReorderQty: number
}

interface RotationData {
  products: RotationProduct[]
  summary: {
    totalProducts: number
    categoryA: { count: number; totalValue: number; percentOfTotal: number }
    categoryB: { count: number; totalValue: number; percentOfTotal: number }
    categoryC: { count: number; totalValue: number; percentOfTotal: number }
  }
}

const formatCurrency = (amount: number) =>
  `$${amount.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

const abcColors = {
  A: 'bg-green-100 text-green-800 border-green-300',
  B: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  C: 'bg-red-100 text-red-800 border-red-300',
}

export default function RotationABCTab() {
  const [period, setPeriod] = useState('12')
  const [abcFilter, setAbcFilter] = useState('ALL')
  const [data, setData] = useState<RotationData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [period])

  const fetchData = async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/inventory/rotation?period=${period}`)
      if (!res.ok) throw new Error()
      setData(await res.json())
    } catch {
      toast.error('Error al cargar rotación')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!data || data.products.length === 0) {
    return (
      <div className="text-center py-12">
        <BarChart3 className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-600">Sin datos de rotación en el período</p>
      </div>
    )
  }

  const filteredProducts = abcFilter === 'ALL'
    ? data.products
    : data.products.filter(p => p.abcCategory === abcFilter)

  // Pareto chart data (top 30)
  const paretoData = data.products.slice(0, 30).map((p, i) => ({
    name: p.sku || p.name.substring(0, 12),
    valor: Math.round(p.totalValuePurchased),
    acumulado: p.cumulativeValuePercent,
  }))

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(['A', 'B', 'C'] as const).map(cat => {
          const catData = data.summary[`category${cat}`]
          return (
            <Card key={cat} className={`border-2 ${abcColors[cat]}`}>
              <CardContent className="pt-4 pb-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-semibold">Categoría {cat}</p>
                    <p className="text-2xl font-bold">{catData.count} productos</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm">{formatCurrency(catData.totalValue)}</p>
                    <p className="text-xs">{catData.percentOfTotal}% del total</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Pareto Chart */}
      {paretoData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Diagrama de Pareto - Top 30 productos</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={paretoData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                <YAxis yAxisId="left" tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                <Tooltip
                  formatter={(value: number | undefined, name: string | undefined) =>
                    name === 'valor' ? [formatCurrency(value ?? 0), 'Valor'] : [`${value ?? 0}%`, 'Acumulado']
                  }
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px' }}
                />
                <Bar yAxisId="left" dataKey="valor" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                <Line yAxisId="right" dataKey="acumulado" stroke="#ef4444" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3">3 meses</SelectItem>
            <SelectItem value="6">6 meses</SelectItem>
            <SelectItem value="12">12 meses</SelectItem>
          </SelectContent>
        </Select>
        <Select value={abcFilter} onValueChange={setAbcFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todas las categorías</SelectItem>
            <SelectItem value="A">Categoría A</SelectItem>
            <SelectItem value="B">Categoría B</SelectItem>
            <SelectItem value="C">Categoría C</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ABC</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Compras</TableHead>
                  <TableHead className="text-right">Cant. Total</TableHead>
                  <TableHead className="text-right">Valor Total</TableHead>
                  <TableHead className="text-right">Días entre compras</TableHead>
                  <TableHead className="text-right">Días hasta quiebre</TableHead>
                  <TableHead className="text-right">Sugerido reponer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map(p => (
                  <TableRow key={p.productId}>
                    <TableCell>
                      <Badge className={abcColors[p.abcCategory]}>{p.abcCategory}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <p className="font-medium text-sm truncate" title={p.name}>{p.name}</p>
                      <p className="text-xs text-gray-500 font-mono">{p.sku}</p>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600 max-w-[160px] truncate" title={p.supplierName || ''}>{p.supplierName || '-'}</TableCell>
                    <TableCell className="text-right">{p.currentStock}</TableCell>
                    <TableCell className="text-right">{p.purchaseCount}</TableCell>
                    <TableCell className="text-right">{p.totalQtyPurchased}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(p.totalValuePurchased)}</TableCell>
                    <TableCell className="text-right">{p.avgDaysBetweenPurchases}d</TableCell>
                    <TableCell className="text-right">
                      <span className={p.estimatedDaysUntilStockout < 30 ? 'text-red-600 font-semibold' : ''}>
                        {p.estimatedDaysUntilStockout > 900 ? '∞' : `${p.estimatedDaysUntilStockout}d`}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {p.suggestedReorderQty > 0 ? (
                        <Badge variant="outline" className="text-xs">{p.suggestedReorderQty}</Badge>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

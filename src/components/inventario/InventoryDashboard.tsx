'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Package, AlertTriangle, TrendingDown, DollarSign, BarChart3, Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

interface DashboardData {
  summary: {
    totalProducts: number
    productsWithStock: number
    productsBelowMin: number
    productsOutOfStock: number
    totalInventoryValue: number
  }
  belowMinimum: Array<{
    id: string; sku: string; name: string; brand: string | null
    stockQuantity: number; minStock: number; deficit: number
    lastCost: number; averageCost: number
  }>
  topPurchased: Array<{
    productId: string; sku: string; name: string; brand: string | null
    totalQtyPurchased: number; totalValuePurchased: number
    purchaseCount: number; lastPurchaseDate: string
  }>
  noMovement: Array<{
    id: string; sku: string; name: string; brand: string | null
    stockQuantity: number; lastMovementDate: string | null
    daysWithoutMovement: number; inventoryValue: number
  }>
  recentMovements: Array<{
    id: string; product: { sku: string; name: string }
    type: string; quantity: number; unitCost: number
    reference: string | null; date: string; userName: string
  }>
  purchasesByMonth: Array<{
    month: string; totalValue: number; totalQty: number; invoiceCount: number
  }>
}

const movementTypeLabels: Record<string, string> = {
  COMPRA: 'Compra',
  VENTA: 'Venta',
  AJUSTE_POSITIVO: 'Ajuste +',
  AJUSTE_NEGATIVO: 'Ajuste -',
  DEVOLUCION_CLIENTE: 'Dev. Cliente',
  DEVOLUCION_PROVEEDOR: 'Dev. Proveedor',
  TRANSFERENCIA: 'Transferencia',
}

const movementTypeColors: Record<string, string> = {
  COMPRA: 'bg-green-100 text-green-800',
  VENTA: 'bg-blue-100 text-blue-800',
  AJUSTE_POSITIVO: 'bg-emerald-100 text-emerald-800',
  AJUSTE_NEGATIVO: 'bg-red-100 text-red-800',
  DEVOLUCION_CLIENTE: 'bg-yellow-100 text-yellow-800',
  DEVOLUCION_PROVEEDOR: 'bg-orange-100 text-orange-800',
  TRANSFERENCIA: 'bg-purple-100 text-purple-800',
}

const formatCurrency = (amount: number) =>
  `$${amount.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })

export default function InventoryDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboard()
  }, [])

  const fetchDashboard = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/inventory/dashboard')
      if (!response.ok) throw new Error('Error al cargar dashboard')
      const result = await response.json()
      setData(result)
    } catch {
      toast.error('Error al cargar dashboard de inventario')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (!data) return null

  // Build 12 months of chart data (fill gaps with $0)
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  const chartData = (() => {
    const byMonth = new Map(data.purchasesByMonth.map(m => [m.month, m]))
    const months: Array<{ mes: string; valor: number; facturas: number }> = []
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const entry = byMonth.get(key)
      months.push({
        mes: monthNames[d.getMonth()],
        valor: entry ? Math.round(entry.totalValue) : 0,
        facturas: entry?.invoiceCount || 0,
      })
    }
    return months
  })()

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card className="border-blue-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-xs text-gray-500">Total productos</p>
                <p className="text-2xl font-bold">{data.summary.totalProducts}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-green-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-xs text-gray-500">Con stock</p>
                <p className="text-2xl font-bold text-green-700">{data.summary.productsWithStock}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <div>
                <p className="text-xs text-gray-500">Bajo mínimo</p>
                <p className="text-2xl font-bold text-red-700">{data.summary.productsBelowMin}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-300 bg-red-50/50">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-700" />
              <div>
                <p className="text-xs text-gray-500">Sin stock</p>
                <p className="text-2xl font-bold text-red-800">{data.summary.productsOutOfStock}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-xs text-gray-500">Valor inventario</p>
                <p className="text-lg font-bold text-emerald-700">
                  {formatCurrency(data.summary.totalInventoryValue)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart: Purchases by Month */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-5 w-5" />
              Compras por mes (próximos 12 meses)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="mes" tick={{ fill: '#6b7280', fontSize: 12 }} />
                <YAxis
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(value: number) => [formatCurrency(value), 'Valor']}
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px' }}
                />
                <Bar dataKey="valor" fill="#3B82F6" radius={[4, 4, 0, 0]} maxBarSize={60} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Below Minimum */}
        <Card className="border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-red-800">
              <AlertTriangle className="h-5 w-5" />
              Productos bajo mínimo ({data.belowMinimum.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.belowMinimum.length === 0 ? (
              <p className="text-center text-gray-500 py-6 text-sm">Sin productos bajo mínimo</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Producto</TableHead>
                      <TableHead className="text-right text-xs">Stock</TableHead>
                      <TableHead className="text-right text-xs">Mín</TableHead>
                      <TableHead className="text-right text-xs">Déficit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.belowMinimum.slice(0, 10).map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="py-2 max-w-[200px]">
                          <p className="text-sm font-medium truncate" title={p.name}>{p.name}</p>
                          <p className="text-xs text-gray-500">{p.sku}</p>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="destructive" className="text-xs">{p.stockQuantity}</Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm">{p.minStock}</TableCell>
                        <TableCell className="text-right text-sm font-semibold text-red-600">
                          -{p.deficit}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* No Movement */}
        <Card className="border-yellow-200">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-yellow-800">
              <Clock className="h-5 w-5" />
              Sin movimiento +90 días ({data.noMovement.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.noMovement.length === 0 ? (
              <p className="text-center text-gray-500 py-6 text-sm">Todos los productos con movimiento reciente</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Producto</TableHead>
                      <TableHead className="text-right text-xs">Stock</TableHead>
                      <TableHead className="text-right text-xs">Días</TableHead>
                      <TableHead className="text-right text-xs">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.noMovement.slice(0, 10).map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="py-2 max-w-[200px]">
                          <p className="text-sm font-medium truncate" title={p.name}>{p.name}</p>
                          <p className="text-xs text-gray-500">{p.sku}</p>
                        </TableCell>
                        <TableCell className="text-right text-sm">{p.stockQuantity}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className="text-xs text-yellow-700">{p.daysWithoutMovement}d</Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(p.inventoryValue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Movements */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Últimos movimientos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Fecha</TableHead>
                  <TableHead className="text-xs">Tipo</TableHead>
                  <TableHead className="text-xs">Producto</TableHead>
                  <TableHead className="text-right text-xs">Cant.</TableHead>
                  <TableHead className="text-right text-xs">Cto. Unit.</TableHead>
                  <TableHead className="text-xs">Referencia</TableHead>
                  <TableHead className="text-xs">Usuario</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentMovements.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="text-sm">{formatDate(m.date)}</TableCell>
                    <TableCell>
                      <Badge className={`text-xs ${movementTypeColors[m.type] || 'bg-gray-100'}`}>
                        {movementTypeLabels[m.type] || m.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-md">
                      <p className="text-sm font-medium truncate" title={m.product.name}>{m.product.name}</p>
                      <p className="text-xs text-gray-500">{m.product.sku}</p>
                    </TableCell>
                    <TableCell className={`text-right text-sm font-semibold ${m.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </TableCell>
                    <TableCell className="text-right text-sm">{formatCurrency(m.unitCost)}</TableCell>
                    <TableCell className="text-sm text-gray-600">{m.reference || '-'}</TableCell>
                    <TableCell className="text-sm text-gray-600">{m.userName}</TableCell>
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

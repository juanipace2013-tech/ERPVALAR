'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { ShoppingCart, Loader2, TrendingUp, TrendingDown } from 'lucide-react'
import { toast } from 'sonner'

const formatCurrency = (amount: number) =>
  `$${amount.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

export default function PurchaseAnalysisTab() {
  const [groupBy, setGroupBy] = useState('product')
  const [period, setPeriod] = useState('12')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [groupBy, period])

  const fetchData = async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/inventory/purchase-analysis?groupBy=${groupBy}&period=${period}`)
      if (!res.ok) throw new Error()
      const result = await res.json()
      setData(result)
    } catch {
      toast.error('Error al cargar análisis')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3">Últimos 3 meses</SelectItem>
            <SelectItem value="6">Últimos 6 meses</SelectItem>
            <SelectItem value="12">Últimos 12 meses</SelectItem>
            <SelectItem value="24">Últimos 24 meses</SelectItem>
          </SelectContent>
        </Select>
        <Select value={groupBy} onValueChange={setGroupBy}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="product">Por producto</SelectItem>
            <SelectItem value="supplier">Por proveedor</SelectItem>
            <SelectItem value="month">Por mes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : !data?.data?.length ? (
        <div className="text-center py-12">
          <ShoppingCart className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600">Sin datos de compras en el período seleccionado</p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              {groupBy === 'product' && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead>Proveedor</TableHead>
                      <TableHead className="text-right">Cant. Total</TableHead>
                      <TableHead className="text-right">Valor Total</TableHead>
                      <TableHead className="text-right"># Facturas</TableHead>
                      <TableHead className="text-right">Últ. Precio</TableHead>
                      <TableHead className="text-right">Var. Precio</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map((item: any) => (
                      <TableRow key={item.productId}>
                        <TableCell>
                          <p className="font-medium">{item.name}</p>
                          <p className="text-xs text-gray-500 font-mono">{item.sku}</p>
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {item.supplierName || '-'}
                        </TableCell>
                        <TableCell className="text-right font-medium">{item.totalQty}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(item.totalValue)}</TableCell>
                        <TableCell className="text-right">{item.invoiceCount}</TableCell>
                        <TableCell className="text-right">{formatCurrency(item.lastPrice)}</TableCell>
                        <TableCell className="text-right">
                          {item.priceVariation !== 0 && (
                            <span className={`flex items-center justify-end gap-1 ${item.priceVariation > 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {item.priceVariation > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                              {item.priceVariation > 0 ? '+' : ''}{item.priceVariation}%
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {groupBy === 'supplier' && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Proveedor</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right">Valor Total</TableHead>
                      <TableHead className="text-right"># Facturas</TableHead>
                      <TableHead>Top Productos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map((item: any) => (
                      <TableRow key={item.supplierId}>
                        <TableCell className="font-medium">{item.supplierName}</TableCell>
                        <TableCell className="text-right">{item.totalItems}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(item.totalValue)}</TableCell>
                        <TableCell className="text-right">{item.invoiceCount}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {item.topProducts?.slice(0, 3).map((p: any, i: number) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {p.name.substring(0, 25)}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {groupBy === 'month' && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mes</TableHead>
                      <TableHead className="text-right">Valor Total</TableHead>
                      <TableHead className="text-right">Cant. Items</TableHead>
                      <TableHead className="text-right"># Facturas</TableHead>
                      <TableHead>Top Proveedor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map((item: any) => (
                      <TableRow key={item.month}>
                        <TableCell className="font-medium">{item.month}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(item.totalValue)}</TableCell>
                        <TableCell className="text-right">{item.totalQty}</TableCell>
                        <TableCell className="text-right">{item.invoiceCount}</TableCell>
                        <TableCell className="text-sm text-gray-600">{item.topSupplier || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

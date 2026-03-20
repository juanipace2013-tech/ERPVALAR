'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { AlertTriangle, Download, Loader2, PackageCheck } from 'lucide-react'
import { toast } from 'sonner'

interface ReportItem {
  productId: string
  sku: string
  name: string
  brand: string
  minStock: number
  currentStock: number
  difference: number
  supplierName: string
}

interface ReportData {
  report: ReportItem[]
  brands: string[]
  summary: {
    totalWithMinStock: number
    belowMinimum: number
    totalToOrder: number
  }
}

export default function ReplenishmentTab() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [onlyBelowMin, setOnlyBelowMin] = useState(true)
  const [brand, setBrand] = useState('ALL')

  useEffect(() => {
    fetchData()
  }, [onlyBelowMin, brand])

  const fetchData = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        onlyBelowMin: String(onlyBelowMin),
      })
      if (brand && brand !== 'ALL') params.set('brand', brand)

      const res = await fetch(`/api/inventory/replenishment-report?${params}`)
      if (!res.ok) throw new Error()
      setData(await res.json())
    } catch {
      toast.error('Error al cargar reporte de reposición')
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    try {
      setExporting(true)
      const params = new URLSearchParams({
        onlyBelowMin: String(onlyBelowMin),
        format: 'excel',
      })
      if (brand && brand !== 'ALL') params.set('brand', brand)

      const res = await fetch(`/api/inventory/replenishment-report?${params}`)
      if (!res.ok) throw new Error()

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Reporte_Reposicion_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Excel exportado')
    } catch {
      toast.error('Error al exportar Excel')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {data?.summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-sm text-gray-500">Con stock mínimo configurado</p>
              <p className="text-2xl font-bold text-blue-700">{data.summary.totalWithMinStock}</p>
            </CardContent>
          </Card>
          <Card className="border-red-200">
            <CardContent className="pt-4 pb-3">
              <p className="text-sm text-gray-500">Bajo mínimo</p>
              <p className="text-2xl font-bold text-red-600">{data.summary.belowMinimum}</p>
            </CardContent>
          </Card>
          <Card className="border-orange-200">
            <CardContent className="pt-4 pb-3">
              <p className="text-sm text-gray-500">Unidades totales a reponer</p>
              <p className="text-2xl font-bold text-orange-600">{data.summary.totalToOrder}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Checkbox
            id="onlyBelowMin"
            checked={onlyBelowMin}
            onCheckedChange={(checked) => setOnlyBelowMin(checked === true)}
          />
          <Label htmlFor="onlyBelowMin" className="text-sm cursor-pointer">
            Solo bajo mínimo
          </Label>
        </div>

        {data?.brands && data.brands.length > 0 && (
          <Select value={brand} onValueChange={setBrand}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filtrar por marca" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas las marcas</SelectItem>
              {data.brands.map(b => (
                <SelectItem key={b} value={b}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          variant="outline"
          onClick={handleExport}
          disabled={exporting || !data?.report?.length}
          className="ml-auto"
        >
          {exporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Exportar Excel
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : !data?.report?.length ? (
        <div className="text-center py-12">
          <PackageCheck className="h-12 w-12 text-green-400 mx-auto mb-4" />
          <p className="text-gray-600">
            {onlyBelowMin
              ? 'Todos los productos están por encima del stock mínimo'
              : 'No hay productos con stock mínimo configurado'}
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Marca</TableHead>
                    <TableHead className="text-right">Stock Mín</TableHead>
                    <TableHead className="text-right">Stock Actual</TableHead>
                    <TableHead className="text-right">A Comprar</TableHead>
                    <TableHead>Proveedor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.report.map(item => {
                    const belowMin = item.difference > 0
                    return (
                      <TableRow
                        key={item.productId}
                        className={belowMin ? 'bg-red-50/60' : ''}
                      >
                        <TableCell className="font-mono text-xs font-bold text-gray-500">
                          {item.sku}
                        </TableCell>
                        <TableCell className="max-w-[300px]">
                          <p className="text-sm font-medium truncate" title={item.name}>
                            {item.name}
                          </p>
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {item.brand || '—'}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {item.minStock}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          <span className={belowMin ? 'text-red-600' : ''}>
                            {item.currentStock}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {belowMin ? (
                            <Badge className="bg-red-100 text-red-700 border-red-300 font-semibold">
                              <AlertTriangle className="mr-1 h-3 w-3" />
                              {item.difference}
                            </Badge>
                          ) : (
                            <span className="text-green-600 font-medium">OK</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600 max-w-[160px] truncate" title={item.supplierName}>
                          {item.supplierName || '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

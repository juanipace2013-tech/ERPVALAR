'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Label } from '@/components/ui/label'
import { PieChart, Download, Printer, Calendar, TrendingUp, TrendingDown } from 'lucide-react'
import { toast } from 'sonner'

interface ResultadoItem {
  account: {
    id: string
    code: string
    name: string
    level: number
  }
  amount: number
}

interface EstadoResultados {
  period: {
    startDate: string
    endDate: string
  }
  ingresos: ResultadoItem[]
  egresos: ResultadoItem[]
  totals: {
    ingresos: number
    egresos: number
    resultado: number
  }
}

export default function EstadoResultadosPage() {
  const [data, setData] = useState<EstadoResultados | null>(null)
  const [loading, setLoading] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const fetchEstadoResultados = async () => {
    if (!startDate || !endDate) {
      toast.error('Debes seleccionar fechas de inicio y fin')
      return
    }

    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.append('startDate', startDate)
      params.append('endDate', endDate)

      const response = await fetch(`/api/contabilidad/estado-resultados?${params}`)

      if (!response.ok) {
        throw new Error('Error al cargar estado de resultados')
      }

      const result = await response.json()
      setData(result)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar estado de resultados')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const handleGenerate = () => {
    fetchEstadoResultados()
  }

  const handlePrint = () => {
    window.print()
  }

  const handleExport = () => {
    toast.info('Función de exportación en desarrollo')
  }

  const getLevelIndent = (level: number) => {
    return `${(level - 1) * 1.5}rem`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Estado de Resultados</h1>
          <p className="text-gray-600 mt-1">
            Resultado del ejercicio (Ingresos - Egresos)
          </p>
        </div>
        {data && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimir
            </Button>
            <Button variant="outline" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Exportar
            </Button>
          </div>
        )}
      </div>

      {/* Filtros */}
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Período del Estado</CardTitle>
          <CardDescription>
            Selecciona el período para generar el estado de resultados
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="startDate">Fecha Desde</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">Fecha Hasta</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleGenerate} className="w-full">
                <Calendar className="mr-2 h-4 w-4" />
                Generar Estado
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Estado de Resultados */}
      {data && (
        <Card>
          <CardHeader className="print:text-center">
            <CardTitle className="print:text-2xl">Estado de Resultados</CardTitle>
            <CardDescription className="print:text-base print:text-gray-700">
              Del {new Date(data.period.startDate).toLocaleDateString('es-AR')} al {new Date(data.period.endDate).toLocaleDateString('es-AR')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12">
                <p className="text-gray-500">Cargando estado de resultados...</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Ingresos */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="h-5 w-5 text-green-600" />
                    <h3 className="text-lg font-bold text-gray-900">INGRESOS</h3>
                  </div>
                  {data.ingresos.length === 0 ? (
                    <p className="text-gray-500 text-sm ml-7">No hay ingresos en este período</p>
                  ) : (
                    <div className="rounded-md border ml-7">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[120px]">Código</TableHead>
                            <TableHead>Cuenta</TableHead>
                            <TableHead className="text-right w-[180px]">Importe</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.ingresos.map((item) => (
                            <TableRow key={item.account.id}>
                              <TableCell className="font-mono text-sm">
                                {item.account.code}
                              </TableCell>
                              <TableCell>
                                <span
                                  style={{ marginLeft: getLevelIndent(item.account.level) }}
                                  className={item.account.level === 1 ? 'font-bold' : item.account.level === 2 ? 'font-semibold' : ''}
                                >
                                  {item.account.name}
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-mono text-green-700">
                                ${item.amount.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-green-50 font-bold">
                            <TableCell colSpan={2} className="text-right">
                              Total Ingresos
                            </TableCell>
                            <TableCell className="text-right font-mono text-green-700 text-lg">
                              ${data.totals.ingresos.toFixed(2)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                {/* Egresos */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingDown className="h-5 w-5 text-red-600" />
                    <h3 className="text-lg font-bold text-gray-900">EGRESOS</h3>
                  </div>
                  {data.egresos.length === 0 ? (
                    <p className="text-gray-500 text-sm ml-7">No hay egresos en este período</p>
                  ) : (
                    <div className="rounded-md border ml-7">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[120px]">Código</TableHead>
                            <TableHead>Cuenta</TableHead>
                            <TableHead className="text-right w-[180px]">Importe</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.egresos.map((item) => (
                            <TableRow key={item.account.id}>
                              <TableCell className="font-mono text-sm">
                                {item.account.code}
                              </TableCell>
                              <TableCell>
                                <span
                                  style={{ marginLeft: getLevelIndent(item.account.level) }}
                                  className={item.account.level === 1 ? 'font-bold' : item.account.level === 2 ? 'font-semibold' : ''}
                                >
                                  {item.account.name}
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-mono text-red-700">
                                ${item.amount.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-red-50 font-bold">
                            <TableCell colSpan={2} className="text-right">
                              Total Egresos
                            </TableCell>
                            <TableCell className="text-right font-mono text-red-700 text-lg">
                              ${data.totals.egresos.toFixed(2)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                {/* Resultado */}
                <Card className={`${
                  data.totals.resultado >= 0
                    ? 'bg-green-50 border-green-200'
                    : 'bg-red-50 border-red-200'
                } print:break-inside-avoid`}>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <PieChart className={`h-8 w-8 ${
                          data.totals.resultado >= 0 ? 'text-green-600' : 'text-red-600'
                        }`} />
                        <div>
                          <p className="text-sm font-medium text-gray-600">
                            Resultado del Ejercicio
                          </p>
                          <p className={`text-3xl font-bold ${
                            data.totals.resultado >= 0 ? 'text-green-700' : 'text-red-700'
                          }`}>
                            ${data.totals.resultado.toFixed(2)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-600">
                          {data.totals.resultado >= 0 ? 'Ganancia' : 'Pérdida'}
                        </p>
                        <p className="text-sm font-medium text-gray-700 mt-1">
                          {data.totals.ingresos > 0
                            ? `${((Math.abs(data.totals.resultado) / data.totals.ingresos) * 100).toFixed(1)}% de ingresos`
                            : '-'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Detalle de Cálculo */}
                <Card className="bg-gray-50 print:break-inside-avoid">
                  <CardContent className="pt-6">
                    <h4 className="font-semibold text-gray-900 mb-3">Detalle del Cálculo</h4>
                    <div className="space-y-2 font-mono text-sm">
                      <div className="flex justify-between">
                        <span>Ingresos:</span>
                        <span className="text-green-700">+ ${data.totals.ingresos.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Egresos:</span>
                        <span className="text-red-700">- ${data.totals.egresos.toFixed(2)}</span>
                      </div>
                      <div className="border-t pt-2 flex justify-between font-bold text-base">
                        <span>Resultado:</span>
                        <span className={data.totals.resultado >= 0 ? 'text-green-700' : 'text-red-700'}>
                          ${data.totals.resultado.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

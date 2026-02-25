'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Download, Printer, Calendar } from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber } from '@/lib/utils'

interface BalanceItem {
  account: {
    id: string
    code: string
    name: string
    level: number
  }
  balance: number
}

interface BalanceGeneral {
  date: string
  activo: BalanceItem[]
  pasivo: BalanceItem[]
  patrimonioNeto: BalanceItem[]
  resultadoEjercicio: number
  totals: {
    activo: number
    pasivo: number
    patrimonioNeto: number
    pasivoPatrimonio: number
  }
}

export default function BalanceGeneralPage() {
  const [data, setData] = useState<BalanceGeneral | null>(null)
  const [loading, setLoading] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])

  const fetchBalanceGeneral = async () => {
    if (!date) {
      toast.error('Debes seleccionar una fecha de corte')
      return
    }

    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.append('date', date)

      const response = await fetch(`/api/contabilidad/balance-general?${params}`)

      if (!response.ok) {
        throw new Error('Error al cargar balance general')
      }

      const result = await response.json()
      setData(result)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar balance general')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const handleGenerate = () => {
    fetchBalanceGeneral()
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
          <h1 className="text-3xl font-bold text-gray-900">Balance General</h1>
          <p className="text-gray-600 mt-1">
            Estado de situación patrimonial
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
          <CardTitle>Fecha de Corte</CardTitle>
          <CardDescription>
            Selecciona la fecha para generar el balance general
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="date">Fecha de Corte</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleGenerate} className="w-full">
                <Calendar className="mr-2 h-4 w-4" />
                Generar Balance
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Balance General */}
      {data && (
        <Card>
          <CardHeader className="print:text-center">
            <CardTitle className="print:text-2xl">Balance General</CardTitle>
            <CardDescription className="print:text-base print:text-gray-700">
              Al {new Date(data.date).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12">
                <p className="text-gray-500">Cargando balance general...</p>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                {/* ACTIVO */}
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4 pb-2 border-b-2 border-blue-600">
                    ACTIVO
                  </h3>
                  {data.activo.length === 0 ? (
                    <p className="text-gray-500 text-sm">No hay activos</p>
                  ) : (
                    <div className="space-y-2">
                      {data.activo.map((item) => (
                        <div key={item.account.id} className="flex justify-between items-start">
                          <span
                            style={{ marginLeft: getLevelIndent(item.account.level) }}
                            className={`text-sm ${
                              item.account.level === 1
                                ? 'font-bold'
                                : item.account.level === 2
                                ? 'font-semibold'
                                : ''
                            }`}
                          >
                            {item.account.code} - {item.account.name}
                          </span>
                          <span className="font-mono text-sm">
                            ${formatNumber(item.balance)}
                          </span>
                        </div>
                      ))}
                      <div className="pt-3 mt-3 border-t-2 border-blue-600 flex justify-between font-bold text-lg">
                        <span>TOTAL ACTIVO</span>
                        <span className="font-mono text-blue-700">
                          ${formatNumber(data.totals.activo)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* PASIVO + PATRIMONIO NETO */}
                <div>
                  {/* PASIVO */}
                  <div className="mb-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-4 pb-2 border-b-2 border-red-600">
                      PASIVO
                    </h3>
                    {data.pasivo.length === 0 ? (
                      <p className="text-gray-500 text-sm">No hay pasivos</p>
                    ) : (
                      <div className="space-y-2">
                        {data.pasivo.map((item) => (
                          <div key={item.account.id} className="flex justify-between items-start">
                            <span
                              style={{ marginLeft: getLevelIndent(item.account.level) }}
                              className={`text-sm ${
                                item.account.level === 1
                                  ? 'font-bold'
                                  : item.account.level === 2
                                  ? 'font-semibold'
                                  : ''
                              }`}
                            >
                              {item.account.code} - {item.account.name}
                            </span>
                            <span className="font-mono text-sm">
                              ${formatNumber(item.balance)}
                            </span>
                          </div>
                        ))}
                        <div className="pt-2 border-t flex justify-between font-semibold">
                          <span>Total Pasivo</span>
                          <span className="font-mono">
                            ${formatNumber(data.totals.pasivo)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* PATRIMONIO NETO */}
                  <div className="mb-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-4 pb-2 border-b-2 border-purple-600">
                      PATRIMONIO NETO
                    </h3>
                    {data.patrimonioNeto.length === 0 && data.resultadoEjercicio === 0 ? (
                      <p className="text-gray-500 text-sm">No hay patrimonio neto</p>
                    ) : (
                      <div className="space-y-2">
                        {data.patrimonioNeto.map((item) => (
                          <div key={item.account.id} className="flex justify-between items-start">
                            <span
                              style={{ marginLeft: getLevelIndent(item.account.level) }}
                              className={`text-sm ${
                                item.account.level === 1
                                  ? 'font-bold'
                                  : item.account.level === 2
                                  ? 'font-semibold'
                                  : ''
                              }`}
                            >
                              {item.account.code} - {item.account.name}
                            </span>
                            <span className="font-mono text-sm">
                              ${formatNumber(item.balance)}
                            </span>
                          </div>
                        ))}
                        {Math.abs(data.resultadoEjercicio) > 0.01 && (
                          <div className="flex justify-between items-start">
                            <span className="text-sm font-semibold">
                              Resultado del Ejercicio
                            </span>
                            <span className={`font-mono text-sm ${
                              data.resultadoEjercicio >= 0 ? 'text-green-700' : 'text-red-700'
                            }`}>
                              ${formatNumber(data.resultadoEjercicio)}
                            </span>
                          </div>
                        )}
                        <div className="pt-2 border-t flex justify-between font-semibold">
                          <span>Total Patrimonio Neto</span>
                          <span className="font-mono">
                            ${formatNumber(data.totals.patrimonioNeto + data.resultadoEjercicio)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* TOTAL PASIVO + PATRIMONIO */}
                  <div className="pt-3 border-t-2 border-red-600 flex justify-between font-bold text-lg">
                    <span>TOTAL PASIVO + PN</span>
                    <span className="font-mono text-red-700">
                      ${formatNumber(data.totals.pasivoPatrimonio)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Validación */}
            {data && (
              <Card className={`mt-6 ${
                Math.abs(data.totals.activo - data.totals.pasivoPatrimonio) < 0.01
                  ? 'bg-green-50 border-green-200'
                  : 'bg-red-50 border-red-200'
              } print:break-inside-avoid`}>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600 mb-1">
                        Ecuación Contable
                      </p>
                      {Math.abs(data.totals.activo - data.totals.pasivoPatrimonio) < 0.01 ? (
                        <p className="text-lg font-bold text-green-700">
                          ✓ Activo = Pasivo + Patrimonio Neto
                        </p>
                      ) : (
                        <p className="text-lg font-bold text-red-700">
                          ✗ Diferencia: ${formatNumber(Math.abs(data.totals.activo - data.totals.pasivoPatrimonio))}
                        </p>
                      )}
                    </div>
                    <div className="text-right font-mono">
                      <p className="text-sm text-gray-600">Activo</p>
                      <p className="text-xl font-bold">${formatNumber(data.totals.activo)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

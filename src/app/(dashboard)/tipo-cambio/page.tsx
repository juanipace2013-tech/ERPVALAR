'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DollarSign,
  Plus,
  Loader2,
  Calendar,
  Building2,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber } from '@/lib/utils'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface ExchangeRate {
  id: string
  fromCurrency: string
  toCurrency: string
  rate: number
  source: string
  validFrom: string
  validUntil: string | null
  createdAt: string
  updatedAt: string
}

const sourceLabels: Record<string, string> = {
  MANUAL: 'Manual',
  BANCO_CENTRAL: 'BCRA',
  API: 'API',
}

const sourceColors: Record<string, string> = {
  MANUAL: 'bg-gray-100 text-gray-800',
  BANCO_CENTRAL: 'bg-green-100 text-green-800',
  API: 'bg-blue-100 text-blue-800',
}

export default function TipoCambioPage() {
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingBCRA, setUpdatingBCRA] = useState(false)
  const [openDialog, setOpenDialog] = useState(false)
  const [formData, setFormData] = useState({
    fromCurrency: 'USD',
    toCurrency: 'ARS',
    rate: '',
    source: 'MANUAL',
  })

  useEffect(() => {
    fetchExchangeRates()
  }, [])

  const fetchExchangeRates = async () => {
    try {
      setLoading(true)
      // Obtener TODO el historial (no solo los vigentes)
      const response = await fetch('/api/tipo-cambio?history=true')

      if (!response.ok) {
        throw new Error('Error al cargar tipos de cambio')
      }

      const data = await response.json()
      // Filtrar solo USD → ARS y ordenar por fecha descendente
      const usdArsRates = (data.rates || [])
        .filter((r: ExchangeRate) => r.fromCurrency === 'USD' && r.toCurrency === 'ARS')
        .sort((a: ExchangeRate, b: ExchangeRate) =>
          new Date(b.validFrom).getTime() - new Date(a.validFrom).getTime()
        )
      setExchangeRates(usdArsRates)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar tipos de cambio')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateFromBCRA = async () => {
    try {
      setUpdatingBCRA(true)
      const response = await fetch('/api/tipo-cambio/bcra', {
        method: 'POST',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Error al actualizar desde BCRA')
      }

      const data = await response.json()
      toast.success(
        `Tipo de cambio actualizado: $${formatNumber(data.bcraData.rate)} (${new Date(
          data.bcraData.date
        ).toLocaleDateString('es-AR')})`
      )
      fetchExchangeRates()
    } catch (error) {
      console.error('Error:', error)
      toast.error(
        error instanceof Error
          ? error.message
          : 'Error al actualizar tipo de cambio desde BCRA'
      )
    } finally {
      setUpdatingBCRA(false)
    }
  }

  const handleCreateManual = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.rate || parseFloat(formData.rate) <= 0) {
      toast.error('El tipo de cambio debe ser mayor a 0')
      return
    }

    try {
      const response = await fetch('/api/tipo-cambio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fromCurrency: formData.fromCurrency,
          toCurrency: formData.toCurrency,
          rate: parseFloat(formData.rate),
          source: formData.source,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Error al crear tipo de cambio')
      }

      toast.success('Tipo de cambio creado exitosamente')
      setOpenDialog(false)
      setFormData({
        fromCurrency: 'USD',
        toCurrency: 'ARS',
        rate: '',
        source: 'MANUAL',
      })
      fetchExchangeRates()
    } catch (error) {
      console.error('Error:', error)
      toast.error(
        error instanceof Error ? error.message : 'Error al crear tipo de cambio'
      )
    }
  }


  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-AR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('es-AR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Calcular variación porcentual respecto al registro anterior
  const calculateVariation = (currentRate: number, index: number): number | null => {
    if (index >= exchangeRates.length - 1) return null // No hay registro anterior
    const previousRate = Number(exchangeRates[index + 1].rate)
    return ((currentRate - previousRate) / previousRate) * 100
  }

  // Preparar datos para el gráfico (últimos 30 registros, invertidos para mostrar cronológicamente)
  const chartData = exchangeRates
    .slice(0, 30)
    .reverse()
    .map(rate => ({
      date: new Date(rate.validFrom).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
      valor: Number(rate.rate),
    }))

  // Obtener el tipo de cambio USD más reciente
  const currentUSDRate = exchangeRates[0]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-blue-900">
            Tipo de Cambio
          </h1>
          <p className="text-muted-foreground">
            Gestión de tipos de cambio y actualización automática desde BCRA
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleUpdateFromBCRA}
            disabled={updatingBCRA}
          >
            {updatingBCRA ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Actualizando...
              </>
            ) : (
              <>
                <Building2 className="mr-2 h-4 w-4" />
                Actualizar desde BCRA
              </>
            )}
          </Button>

          <Dialog open={openDialog} onOpenChange={setOpenDialog}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="mr-2 h-4 w-4" />
                Agregar Manual
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleCreateManual}>
                <DialogHeader>
                  <DialogTitle>Agregar Tipo de Cambio Manual</DialogTitle>
                  <DialogDescription>
                    Crear un tipo de cambio manualmente
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="fromCurrency">Moneda Origen</Label>
                      <Select
                        value={formData.fromCurrency}
                        onValueChange={(value) =>
                          setFormData({ ...formData, fromCurrency: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="USD">USD - Dólar</SelectItem>
                          <SelectItem value="EUR">EUR - Euro</SelectItem>
                          <SelectItem value="ARS">ARS - Peso</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="toCurrency">Moneda Destino</Label>
                      <Select
                        value={formData.toCurrency}
                        onValueChange={(value) =>
                          setFormData({ ...formData, toCurrency: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ARS">ARS - Peso</SelectItem>
                          <SelectItem value="USD">USD - Dólar</SelectItem>
                          <SelectItem value="EUR">EUR - Euro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="rate">Tipo de Cambio</Label>
                    <Input
                      id="rate"
                      type="number"
                      step="0.000001"
                      min="0"
                      placeholder="1250.50"
                      value={formData.rate}
                      onChange={(e) =>
                        setFormData({ ...formData, rate: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="source">Origen</Label>
                    <Select
                      value={formData.source}
                      onValueChange={(value) =>
                        setFormData({ ...formData, source: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MANUAL">Manual</SelectItem>
                        <SelectItem value="API">API Externa</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpenDialog(false)}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                    Crear
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Current USD Rate Card */}
      {currentUSDRate && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="rounded-full bg-blue-600 p-3">
                  <DollarSign className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    Tipo de Cambio USD Actual
                  </p>
                  <p className="text-3xl font-bold text-blue-900">
                    ${formatNumber(currentUSDRate.rate)}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge className={sourceColors[currentUSDRate.source]}>
                      {sourceLabels[currentUSDRate.source]}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Vigente desde {formatDate(currentUSDRate.validFrom)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Última actualización</p>
                <p className="text-sm font-medium">
                  {formatDateTime(currentUSDRate.updatedAt)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chart */}
      {exchangeRates.length > 1 && (
        <Card className="border-blue-200">
          <CardHeader>
            <CardTitle className="text-blue-900">Evolución del Tipo de Cambio</CardTitle>
            <CardDescription>
              Últimos {Math.min(30, exchangeRates.length)} registros
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e7ff" />
                <XAxis
                  dataKey="date"
                  stroke="#64748b"
                  style={{ fontSize: '12px' }}
                />
                <YAxis
                  stroke="#64748b"
                  style={{ fontSize: '12px' }}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #dbeafe',
                    borderRadius: '8px',
                    padding: '8px'
                  }}
                  formatter={(value?: number) => [`$${formatNumber(value ?? 0)}`, 'Tipo de Cambio']}
                />
                <Line
                  type="monotone"
                  dataKey="valor"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={{ fill: '#2563eb', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Exchange Rates Table */}
      <Card className="border-blue-200">
        <CardHeader>
          <CardTitle className="text-blue-900">
            Historial de Tipos de Cambio USD → ARS
          </CardTitle>
          <CardDescription>
            Registro completo ordenado por fecha (más reciente primero)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : exchangeRates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <DollarSign className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-lg">
                No hay tipos de cambio registrados
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Actualiza desde BCRA o agrega uno manualmente
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-blue-100 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-blue-50 hover:bg-blue-50">
                    <TableHead className="font-semibold text-blue-900">
                      Fecha
                    </TableHead>
                    <TableHead className="text-right font-semibold text-blue-900">
                      Tipo de Cambio
                    </TableHead>
                    <TableHead className="font-semibold text-blue-900">
                      Origen
                    </TableHead>
                    <TableHead className="text-right font-semibold text-blue-900">
                      Variación
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exchangeRates.map((rate, index) => {
                    const variation = calculateVariation(Number(rate.rate), index)
                    return (
                      <TableRow
                        key={rate.id}
                        className="hover:bg-blue-50 transition-colors"
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">
                              {formatDate(rate.validFrom)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-mono text-lg font-semibold">
                            ${formatNumber(rate.rate)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge className={sourceColors[rate.source]}>
                            {sourceLabels[rate.source]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {variation !== null ? (
                            <div className={`flex items-center justify-end gap-1 ${
                              variation > 0 ? 'text-red-600' : variation < 0 ? 'text-green-600' : 'text-gray-600'
                            }`}>
                              {variation > 0 ? (
                                <TrendingUp className="h-4 w-4" />
                              ) : variation < 0 ? (
                                <TrendingDown className="h-4 w-4" />
                              ) : null}
                              <span className="font-semibold">
                                {variation > 0 ? '+' : ''}{formatNumber(variation)}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">Base</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

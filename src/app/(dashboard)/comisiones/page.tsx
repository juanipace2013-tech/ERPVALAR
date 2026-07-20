'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Percent, TrendingUp, DollarSign, FileClock, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, formatNumber, parseDecimalAR } from '@/lib/utils'

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

interface Vendedor {
  id: string
  name: string
}

interface Resumen {
  liquidacionId: string | null
  estado: string | null
  totalFacturadoUsd: number
  tasaMes: number | null
  comisionesArs: number
  cantidadFacturas: number
  tcCargado: boolean
}

interface PipelineItem {
  quoteId: string | null
  quoteNumber: string
  cliente: string
  fecha: string
  totalUsd: number
  facturadoUsd: number
  saldoUsd: number
}

interface LiquidacionResumen {
  id: string
  anio: number
  mes: number
  estado: string
  totalFacturadoUsd: string
  tasaMes: string | null
  comisionesArs: string
  netoArs: string
  _count: { lineas: number }
}

interface DashboardData {
  vendedores: Vendedor[]
  vendedorId: string | null
  anio: number
  mes: number
  resumen: Resumen | null
  pipeline: { items: PipelineItem[]; pipelineUsd: number } | null
  liquidaciones: LiquidacionResumen[]
  basicoArs: number | null
}

export default function ComisionesPage() {
  const router = useRouter()
  const hoy = new Date()
  const [vendedorId, setVendedorId] = useState<string>('')
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes, setMes] = useState(hoy.getMonth() + 1)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [abriendo, setAbriendo] = useState(false)
  const [tcBillete, setTcBillete] = useState('')
  const [tcDivisa, setTcDivisa] = useState('')
  const [guardandoTc, setGuardandoTc] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ anio: String(anio), mes: String(mes) })
      if (vendedorId) params.set('vendedorId', vendedorId)
      const res = await fetch(`/api/comisiones/dashboard?${params}`)
      if (!res.ok) throw new Error('Error al cargar')
      const json: DashboardData = await res.json()
      setData(json)
      if (!vendedorId && json.vendedorId) setVendedorId(json.vendedorId)
    } catch {
      toast.error('No se pudo cargar el dashboard de comisiones')
    } finally {
      setLoading(false)
    }
  }, [vendedorId, anio, mes])

  useEffect(() => {
    cargar()
  }, [cargar])

  const abrirLiquidacion = async () => {
    if (!vendedorId) return
    setAbriendo(true)
    try {
      const res = await fetch('/api/comisiones/liquidaciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendedorId, anio, mes }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error')
      router.push(`/comisiones/liquidaciones/${json.liquidacion.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo abrir la liquidación')
      setAbriendo(false)
    }
  }

  const guardarTc = async () => {
    const billete = parseDecimalAR(tcBillete)
    const divisa = parseDecimalAR(tcDivisa)
    if (billete <= 0 || divisa <= 0) {
      toast.error('Cargá ambos tipos de cambio (billete y divisa)')
      return
    }
    setGuardandoTc(true)
    try {
      const res = await fetch('/api/comisiones/tipo-cambio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anio, mes, billete, divisa }),
      })
      if (!res.ok) throw new Error()
      toast.success(`TC de ${MESES[mes - 1]} guardado`)
      await cargar()
    } catch {
      toast.error('No se pudo guardar el tipo de cambio')
    } finally {
      setGuardandoTc(false)
    }
  }

  const resumen = data?.resumen
  const pipeline = data?.pipeline

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Percent className="h-6 w-6" /> Comisiones
          </h1>
          <p className="text-sm text-muted-foreground">
            Liquidación mensual sobre lo facturado. El total USD del mes define el tramo de toda la
            facturación; lo cerrado sin facturar es solo forecast.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={vendedorId} onValueChange={setVendedorId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Vendedor" />
            </SelectTrigger>
            <SelectContent>
              {data?.vendedores.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MESES.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[hoy.getFullYear() + 1, hoy.getFullYear(), hoy.getFullYear() - 1].map((a) => (
                <SelectItem key={a} value={String(a)}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Facturado {MESES[mes - 1]} (USD)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(resumen?.totalFacturadoUsd ?? 0, 'USD')}
                </div>
                <p className="text-xs text-muted-foreground">
                  {resumen?.cantidadFacturas ?? 0} facturas
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Tramo / tasa del mes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {resumen?.tasaMes != null ? `${formatNumber(resumen.tasaMes * 100)}%` : '—'}
                </div>
                <p className="text-xs text-muted-foreground">
                  {resumen?.estado === 'CERRADA' ? 'Congelada (liquidación cerrada)' : 'Provisoria hasta el cierre'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Comisión ARS acumulada
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(resumen?.comisionesArs ?? 0, 'ARS')}
                </div>
                {!resumen?.tcCargado && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Falta el TC del mes
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  En cierre — pipeline (USD)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(pipeline?.pipelineUsd ?? 0, 'USD')}
                </div>
                <p className="text-xs text-muted-foreground">
                  Aprobado sin facturar · no se paga ni empuja el tramo
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Button onClick={abrirLiquidacion} disabled={abriendo || !vendedorId}>
              {abriendo ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <FileClock className="h-4 w-4 mr-2" />
              )}
              {resumen?.liquidacionId ? 'Ver liquidación del mes' : 'Abrir liquidación del mes'}
            </Button>
            <div className="flex items-end gap-2 ml-auto">
              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> TC billete {MESES[mes - 1]}
                </label>
                <Input
                  className="w-28"
                  placeholder="1465"
                  value={tcBillete}
                  onChange={(e) => setTcBillete(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> TC divisa
                </label>
                <Input
                  className="w-28"
                  placeholder="1444,5"
                  value={tcDivisa}
                  onChange={(e) => setTcDivisa(e.target.value)}
                />
              </div>
              <Button variant="outline" onClick={guardarTc} disabled={guardandoTc}>
                {guardandoTc && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Guardar TC
              </Button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Liquidaciones</CardTitle>
              </CardHeader>
              <CardContent>
                {data && data.liquidaciones.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mes</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="text-right">Facturado USD</TableHead>
                        <TableHead className="text-right">Tasa</TableHead>
                        <TableHead className="text-right">Comisiones ARS</TableHead>
                        <TableHead className="text-right">Neto ARS</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.liquidaciones.map((l) => (
                        <TableRow
                          key={l.id}
                          className="cursor-pointer"
                          onClick={() => router.push(`/comisiones/liquidaciones/${l.id}`)}
                        >
                          <TableCell>
                            {MESES[l.mes - 1]} {l.anio}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                l.estado === 'CERRADA'
                                  ? 'bg-green-100 text-green-800 border-green-300'
                                  : 'bg-yellow-100 text-yellow-800 border-yellow-300'
                              }
                            >
                              {l.estado}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(l.totalFacturadoUsd, 'USD')}
                          </TableCell>
                          <TableCell className="text-right">
                            {l.tasaMes != null ? `${formatNumber(Number(l.tasaMes) * 100)}%` : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(l.comisionesArs, 'ARS')}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(l.netoArs, 'ARS')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground py-4">
                    Sin liquidaciones todavía. Abrí la del mes para empezar.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" /> Pipeline cerrado sin facturar (USD)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {pipeline && pipeline.items.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Presupuesto</TableHead>
                        <TableHead className="text-right">Cerrado</TableHead>
                        <TableHead className="text-right">Facturado</TableHead>
                        <TableHead className="text-right">Saldo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pipeline.items.map((p) => (
                        <TableRow key={`${p.quoteNumber}-${p.cliente}`}>
                          <TableCell className="max-w-48 truncate">{p.cliente}</TableCell>
                          <TableCell>{p.quoteNumber}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(p.totalUsd, 'USD')}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(p.facturadoUsd, 'USD')}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(p.saldoUsd, 'USD')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground py-4">Sin saldos pendientes.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from 'recharts'
import { Loader2, Search, ShieldCheck, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { toast } from 'sonner'

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Entidad {
  entidad: number
  entidadNombre?: string
  situacion: number
  fechaSituacion?: string
  diasAtrasoPago?: number
  monto?: number
  refinanciaciones?: boolean
  recategorizacionObligacion?: boolean
  situacionJuridica?: boolean
  procesoJudicial?: boolean
}

interface HistorialPeriodo {
  periodo: string
  entidades: Array<{ entidad: number; situacion: number; monto?: number }>
}

interface ChequeEntidad {
  entidad?: number
  entidadNombre?: string
  numeroCheque?: string
  fechaRechazo?: string
  monto?: number
  moneda?: string
  pagado?: boolean
  fechaPago?: string | null
}

interface Causal {
  causal?: number
  descripcionCausal?: string
  entidades?: ChequeEntidad[]
  cantidadCheques?: number
}

interface BcraResult {
  cuit: string
  denominacion: string
  deudas: {
    status: number
    results?: {
      denominacion?: string
      periodoInformacion?: string
      entidades?: Entidad[]
    }
  } | null
  historicas: {
    status: number
    results?: {
      denominacion?: string
      periodos?: HistorialPeriodo[]
    }
  } | null
  cheques: {
    status: number
    results?: {
      denominacion?: string
      causales?: Causal[]
    }
  } | null
  resumen: {
    situacionPeor: number
    montoTotalDeuda: number
    cantidadEntidades: number
    cantidadChequesRechazados: number
    semaforo: 'verde' | 'amarillo' | 'rojo'
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function formatPeriodo(p: string): string {
  // El BCRA devuelve "YYYYMM" (ej: "202512"), no "YYYY-MM"
  const clean = p.replace('-', '')
  const year = clean.substring(0, 4)
  const month = clean.substring(4, 6)
  return `${MESES[parseInt(month) - 1]} ${year.slice(2)}`
}

function formatCuit(raw: string): string {
  const c = raw.replace(/\D/g, '')
  if (c.length !== 11) return raw
  return `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`
}

function formatMonto(n: number): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const SITUACION_LABEL: Record<number, string> = {
  0: 'Sin deudas',
  1: 'Normal',
  2: 'Con seguimiento',
  3: 'Con problemas',
  4: 'Alto riesgo',
  5: 'Irrecuperable',
}

const SITUACION_BADGE: Record<number, string> = {
  0: 'bg-green-100 text-green-800',
  1: 'bg-green-100 text-green-800',
  2: 'bg-cyan-100 text-cyan-800',
  3: 'bg-yellow-100 text-yellow-800',
  4: 'bg-orange-100 text-orange-800',
  5: 'bg-red-100 text-red-800',
}

// ─── Semáforo ─────────────────────────────────────────────────────────────────

function SemaforoIcon({ semaforo }: { semaforo: 'verde' | 'amarillo' | 'rojo' }) {
  if (semaforo === 'verde') return <CheckCircle2 className="h-8 w-8 text-green-500" />
  if (semaforo === 'amarillo') return <AlertTriangle className="h-8 w-8 text-yellow-500" />
  return <XCircle className="h-8 w-8 text-red-500" />
}

function semaforoLabel(s: 'verde' | 'amarillo' | 'rojo'): string {
  if (s === 'verde') return 'SITUACIÓN NORMAL'
  if (s === 'amarillo') return 'CON OBSERVACIONES'
  return 'SITUACIÓN IRREGULAR'
}

function semaforoColor(s: 'verde' | 'amarillo' | 'rojo'): string {
  if (s === 'verde') return 'border-green-300 bg-green-50'
  if (s === 'amarillo') return 'border-yellow-300 bg-yellow-50'
  return 'border-red-300 bg-red-50'
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function AnalisisCrediticioPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [cuitInput, setCuitInput] = useState(searchParams.get('cuit') || '')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BcraResult | null>(null)
  const [error, setError] = useState('')

  const buscar = useCallback(
    async (cuit: string) => {
      const clean = cuit.replace(/\D/g, '')
      if (clean.length !== 11) {
        setError('Ingrese un CUIT válido de 11 dígitos (ej: 30-71187675-4)')
        return
      }
      setLoading(true)
      setError('')
      setResult(null)
      try {
        const res = await fetch(`/api/bcra/${clean}`)
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Error al consultar BCRA')
        }
        const data: BcraResult = await res.json()
        setResult(data)
        router.replace(`/analisis-crediticio?cuit=${clean}`, { scroll: false })
        // Guardar en sessionStorage para indicador en cotizaciones
        const key = `bcra_${clean}`
        sessionStorage.setItem(
          key,
          JSON.stringify({ semaforo: data.resumen.semaforo, ts: Date.now() })
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al consultar BCRA')
        toast.error('Error al consultar BCRA')
      } finally {
        setLoading(false)
      }
    },
    [router]
  )

  // Auto-buscar si viene con ?cuit= en la URL
  useEffect(() => {
    const cuit = searchParams.get('cuit')
    if (cuit) {
      setCuitInput(cuit)
      buscar(cuit)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Chart data ──────────────────────────────────────────────────────────────

  const chartData = useMemo(() => {
    const periodos = result?.historicas?.results?.periodos ?? []
    return periodos
      .sort((a, b) => a.periodo.localeCompare(b.periodo))
      .slice(-24)
      .map((p) => ({
        mes: formatPeriodo(p.periodo),
        periodo: p.periodo,
        situacion:
          p.entidades.length > 0
            ? Math.max(...p.entidades.map((e) => Number(e.situacion) || 1))
            : 1,
      }))
  }, [result])

  // ─── Entidades deuda actual ───────────────────────────────────────────────────

  const entidades: Entidad[] = result?.deudas?.results?.entidades ?? []

  // ─── Cheques rechazados ───────────────────────────────────────────────────────

  const allCheques: Array<ChequeEntidad & { descripcionCausal?: string }> = useMemo(() => {
    const causales = result?.cheques?.results?.causales ?? []
    const list: Array<ChequeEntidad & { descripcionCausal?: string }> = []
    for (const c of causales) {
      for (const ch of c.entidades ?? []) {
        list.push({ ...ch, descripcionCausal: c.descripcionCausal })
      }
    }
    return list
  }, [result])

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="container mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-8 w-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Análisis Crediticio BCRA</h1>
          <p className="text-gray-600 text-sm mt-0.5">
            Consulta la Central de Deudores del Banco Central de la República Argentina
          </p>
        </div>
      </div>

      {/* Buscador */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-3 max-w-lg">
            <Input
              placeholder="CUIT: XX-XXXXXXXX-X"
              value={cuitInput}
              onChange={(e) => setCuitInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && buscar(cuitInput)}
              className="font-mono"
            />
            <Button
              onClick={() => buscar(cuitInput)}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 whitespace-nowrap"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Consultar
            </Button>
          </div>
          {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
          <p className="text-xs text-gray-400 mt-2">
            Los resultados se almacenan en caché por 24 horas
          </p>
        </CardContent>
      </Card>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-blue-600 mx-auto" />
            <p className="text-gray-500 mt-3">Consultando Central de Deudores BCRA...</p>
          </div>
        </div>
      )}

      {/* Resultados */}
      {result && !loading && (
        <>
          {/* Card principal - Semáforo */}
          <Card className={`border-2 ${semaforoColor(result.resumen.semaforo)}`}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <SemaforoIcon semaforo={result.resumen.semaforo} />
                  <div>
                    <p
                      className={`text-lg font-bold ${
                        result.resumen.semaforo === 'verde'
                          ? 'text-green-700'
                          : result.resumen.semaforo === 'amarillo'
                          ? 'text-yellow-700'
                          : 'text-red-700'
                      }`}
                    >
                      {semaforoLabel(result.resumen.semaforo)}
                    </p>
                    <p className="text-xl font-semibold text-gray-900 mt-0.5">
                      {result.denominacion || '—'}
                    </p>
                    <p className="text-sm text-gray-500 font-mono">{result.cuit}</p>
                  </div>
                </div>
                <div className="text-right space-y-1">
                  <div>
                    <p className="text-xs text-gray-500">Deuda total</p>
                    <p className="text-lg font-bold text-gray-800">
                      ${formatMonto(result.resumen.montoTotalDeuda)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Entidades</p>
                    <p className="font-semibold">{result.resumen.cantidadEntidades}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Cheques rechazados</p>
                    <p
                      className={`font-semibold ${
                        result.resumen.cantidadChequesRechazados > 0
                          ? 'text-red-600'
                          : 'text-green-600'
                      }`}
                    >
                      {result.resumen.cantidadChequesRechazados}
                    </p>
                  </div>
                </div>
              </div>

              {result.deudas?.results?.periodoInformacion && (
                <p className="text-xs text-gray-400 mt-3">
                  Período de información: {formatPeriodo(result.deudas.results.periodoInformacion)}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Tabla deudas por entidad */}
          {entidades.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Deudas por Entidad</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entidad</TableHead>
                      <TableHead>Situación</TableHead>
                      <TableHead className="text-right">Monto (miles $)</TableHead>
                      <TableHead className="text-right">Días atraso</TableHead>
                      <TableHead>Observaciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entidades.map((e, i) => {
                      const obs = []
                      if (e.refinanciaciones) obs.push('Refinanciado')
                      if (e.recategorizacionObligacion) obs.push('Recategorizado')
                      if (e.situacionJuridica) obs.push('Sit. Jurídica')
                      if (e.procesoJudicial) obs.push('Proceso Judicial')
                      return (
                        <TableRow key={i}>
                          <TableCell>
                            <p className="font-medium">{e.entidadNombre || `Entidad ${e.entidad}`}</p>
                          </TableCell>
                          <TableCell>
                            <Badge className={SITUACION_BADGE[e.situacion] || SITUACION_BADGE[1]}>
                              {e.situacion} – {SITUACION_LABEL[e.situacion] || 'Desconocida'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {e.monto != null ? formatMonto(e.monto) : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {e.diasAtrasoPago != null ? (
                              <span className={e.diasAtrasoPago > 0 ? 'text-red-600 font-semibold' : ''}>
                                {e.diasAtrasoPago}
                              </span>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-gray-500">
                            {obs.length > 0 ? obs.join(', ') : '—'}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-gray-500">
                <CheckCircle2 className="h-10 w-10 text-green-400 mx-auto mb-3" />
                Sin deudas registradas en la Central de Deudores
              </CardContent>
            </Card>
          )}

          {/* Gráfico historial 24 meses */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Evolución Histórica (últimos 24 meses)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />

                      {/* Zonas de color de fondo */}
                      <ReferenceArea y1={0.5} y2={1.5} fill="#dcfce7" fillOpacity={0.6} />
                      <ReferenceArea y1={1.5} y2={3.5} fill="#fef9c3" fillOpacity={0.5} />
                      <ReferenceArea y1={3.5} y2={5.5} fill="#fee2e2" fillOpacity={0.5} />

                      <XAxis
                        dataKey="mes"
                        tick={{ fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        domain={[0.5, 5.5]}
                        ticks={[1, 2, 3, 4, 5]}
                        tickFormatter={(v) => SITUACION_LABEL[v] ?? String(v)}
                        tick={{ fontSize: 10 }}
                        width={110}
                      />
                      <Tooltip
                        formatter={(value: number) => [
                          `${value} – ${SITUACION_LABEL[value] ?? ''}`,
                          'Situación',
                        ]}
                        labelFormatter={(label) => `Período: ${label}`}
                      />
                      <ReferenceLine y={1} stroke="#22c55e" strokeDasharray="4 2" strokeWidth={1} />
                      <ReferenceLine y={3} stroke="#eab308" strokeDasharray="4 2" strokeWidth={1} />
                      <Line
                        type="monotone"
                        dataKey="situacion"
                        stroke="#2563eb"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: '#2563eb' }}
                        activeDot={{ r: 5 }}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex gap-4 justify-center mt-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm bg-green-200" /> Normal (1)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm bg-yellow-200" /> Seguimiento / Problemas (2–3)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm bg-red-200" /> Alto riesgo / Irrecup. (4–5)
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Cheques rechazados */}
          <Card>
            <CardHeader>
              <CardTitle>Cheques Rechazados</CardTitle>
            </CardHeader>
            <CardContent>
              {allCheques.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha Rechazo</TableHead>
                      <TableHead>Entidad</TableHead>
                      <TableHead>Nº Cheque</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead>Causal</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allCheques.map((ch, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          {ch.fechaRechazo
                            ? new Date(ch.fechaRechazo).toLocaleDateString('es-AR')
                            : '—'}
                        </TableCell>
                        <TableCell>{ch.entidadNombre || `Entidad ${ch.entidad}` || '—'}</TableCell>
                        <TableCell className="font-mono">{ch.numeroCheque || '—'}</TableCell>
                        <TableCell className="text-right font-mono">
                          {ch.monto != null
                            ? `${ch.moneda || 'ARS'} ${formatMonto(ch.monto)}`
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-red-100 text-red-800 text-xs">
                            {ch.descripcionCausal || '—'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {ch.pagado ? (
                            <Badge className="bg-green-100 text-green-800 text-xs">
                              Pagado
                            </Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-800 text-xs">
                              Impago
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-6 text-gray-500">
                  <CheckCircle2 className="h-8 w-8 text-green-400 mx-auto mb-2" />
                  <p>Sin cheques rechazados ✓</p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

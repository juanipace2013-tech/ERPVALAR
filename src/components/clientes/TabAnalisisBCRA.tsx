'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
  Loader2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'

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
      periodos?: Array<{
        periodo: string
        entidades: Array<{ entidad: number; situacion: number; monto?: number }>
      }>
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
  const clean = p.replace('-', '')
  const year = clean.substring(0, 4)
  const month = clean.substring(4, 6)
  return `${MESES[parseInt(month) - 1]} ${year.slice(2)}`
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

function SemaforoIcon({ semaforo }: { semaforo: 'verde' | 'amarillo' | 'rojo' }) {
  if (semaforo === 'verde') return <CheckCircle2 className="h-7 w-7 text-green-500" />
  if (semaforo === 'amarillo') return <AlertTriangle className="h-7 w-7 text-yellow-500" />
  return <XCircle className="h-7 w-7 text-red-500" />
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

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  cuit: string
}

export default function TabAnalisisBCRA({ cuit }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<BcraResult | null>(null)

  const fetchBCRA = useCallback(async () => {
    if (!cuit) return
    const cleanCuit = cuit.replace(/\D/g, '')
    if (cleanCuit.length !== 11) {
      setError('CUIT inválido')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/bcra/${cleanCuit}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Error al consultar BCRA')
      }
      const data: BcraResult = await res.json()
      setResult(data)
    } catch (e: any) {
      setError(e.message || 'Error al consultar BCRA')
    } finally {
      setLoading(false)
    }
  }, [cuit])

  useEffect(() => {
    fetchBCRA()
  }, [fetchBCRA])

  const entidades: Entidad[] = result?.deudas?.results?.entidades ?? []

  const allCheques = useMemo(() => {
    const causales = result?.cheques?.results?.causales ?? []
    const list: Array<ChequeEntidad & { descripcionCausal?: string }> = []
    for (const c of causales) {
      for (const ch of c.entidades ?? []) {
        list.push({ ...ch, descripcionCausal: c.descripcionCausal })
      }
    }
    return list
  }, [result])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-3" />
        <p className="text-gray-500 text-sm">Consultando Central de Deudores BCRA...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-600 text-sm">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={fetchBCRA}>
          Reintentar
        </Button>
      </div>
    )
  }

  if (!result) return null

  return (
    <div className="space-y-4">
      {/* Semáforo */}
      <Card className={`border-2 ${semaforoColor(result.resumen.semaforo)}`}>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <SemaforoIcon semaforo={result.resumen.semaforo} />
              <div>
                <p
                  className={`text-base font-bold ${
                    result.resumen.semaforo === 'verde'
                      ? 'text-green-700'
                      : result.resumen.semaforo === 'amarillo'
                      ? 'text-yellow-700'
                      : 'text-red-700'
                  }`}
                >
                  {semaforoLabel(result.resumen.semaforo)}
                </p>
                <p className="text-sm text-gray-500">
                  {result.denominacion || '—'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-right">
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
                <p className="text-xs text-gray-500">Cheques rech.</p>
                <p className={`font-semibold ${result.resumen.cantidadChequesRechazados > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {result.resumen.cantidadChequesRechazados}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={fetchBCRA} disabled={loading}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {result.deudas?.results?.periodoInformacion && (
            <p className="text-xs text-gray-400 mt-2">
              Período: {formatPeriodo(result.deudas.results.periodoInformacion)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Deudas por entidad */}
      {entidades.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Deudas por Entidad</CardTitle>
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
                        <p className="font-medium text-sm">{e.entidadNombre || `Entidad ${e.entidad}`}</p>
                      </TableCell>
                      <TableCell>
                        <Badge className={SITUACION_BADGE[e.situacion] || SITUACION_BADGE[1]}>
                          {e.situacion} - {SITUACION_LABEL[e.situacion] || 'Desconocida'}
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
                        ) : '—'}
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
          <CardContent className="py-6 text-center text-gray-500">
            <CheckCircle2 className="h-8 w-8 text-green-400 mx-auto mb-2" />
            Sin deudas registradas en la Central de Deudores
          </CardContent>
        </Card>
      )}

      {/* Cheques rechazados */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Cheques Rechazados</CardTitle>
        </CardHeader>
        <CardContent>
          {allCheques.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha Rechazo</TableHead>
                  <TableHead>Entidad</TableHead>
                  <TableHead>Nro Cheque</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Causal</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allCheques.map((ch, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {ch.fechaRechazo
                        ? new Date(ch.fechaRechazo).toLocaleDateString('es-AR')
                        : '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {ch.entidadNombre || `Entidad ${ch.entidad}` || '—'}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{ch.numeroCheque || '—'}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {ch.monto != null ? `${ch.moneda || 'ARS'} ${formatMonto(ch.monto)}` : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge className="bg-red-100 text-red-800 text-xs">
                        {ch.descripcionCausal || '—'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {ch.pagado ? (
                        <Badge className="bg-green-100 text-green-800 text-xs">Pagado</Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800 text-xs">Impago</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-4 text-gray-500">
              <CheckCircle2 className="h-6 w-6 text-green-400 mx-auto mb-1" />
              <p className="text-sm">Sin cheques rechazados</p>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400 text-right">
        Datos del BCRA - Central de Deudores. Cache de 24 horas.
      </p>
    </div>
  )
}

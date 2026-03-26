'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
  Save,
  Clock,
} from 'lucide-react'

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Semaforo = 'verde' | 'amarillo' | 'rojo'

interface BcraResult {
  cuit: string
  denominacion: string
  resumen: {
    situacionPeor: number
    montoTotalDeuda: number
    cantidadEntidades: number
    cantidadChequesRechazados: number
    semaforo: Semaforo
  }
  notas?: string
  registradoPor?: string
  registradoEl?: string
  _source?: string
  noData?: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function SemaforoIcon({ semaforo }: { semaforo: Semaforo }) {
  if (semaforo === 'verde') return <CheckCircle2 className="h-7 w-7 text-green-500" />
  if (semaforo === 'amarillo') return <AlertTriangle className="h-7 w-7 text-yellow-500" />
  return <XCircle className="h-7 w-7 text-red-500" />
}

function semaforoLabel(s: Semaforo): string {
  if (s === 'verde') return 'SITUACIÓN NORMAL'
  if (s === 'amarillo') return 'CON OBSERVACIONES'
  return 'SITUACIÓN IRREGULAR'
}

function semaforoColor(s: Semaforo): string {
  if (s === 'verde') return 'border-green-300 bg-green-50'
  if (s === 'amarillo') return 'border-yellow-300 bg-yellow-50'
  return 'border-red-300 bg-red-50'
}

function semaforoBtnClass(s: Semaforo, selected: boolean): string {
  const base = 'flex-1 py-3 px-4 rounded-lg border-2 font-semibold text-sm transition-all'
  if (!selected) return `${base} border-gray-200 bg-white text-gray-500 hover:border-gray-300`
  if (s === 'verde') return `${base} border-green-500 bg-green-50 text-green-700 ring-2 ring-green-200`
  if (s === 'amarillo') return `${base} border-yellow-500 bg-yellow-50 text-yellow-700 ring-2 ring-yellow-200`
  return `${base} border-red-500 bg-red-50 text-red-700 ring-2 ring-red-200`
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  cuit: string
  customerName?: string
}

export default function TabAnalisisBCRA({ cuit, customerName }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<BcraResult | null>(null)

  // Estado del formulario de registro manual
  const [showRegister, setShowRegister] = useState(false)
  const [selectedSemaforo, setSelectedSemaforo] = useState<Semaforo | null>(null)
  const [notas, setNotas] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  const cleanCuit = cuit.replace(/\D/g, '')

  // Cargar último resultado cacheado
  const fetchCached = useCallback(async () => {
    if (cleanCuit.length !== 11) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/bcra/${cleanCuit}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Error al consultar historial')
      }
      const data = await res.json()
      if (!data.noData) {
        setResult(data)
      }
    } catch (e: any) {
      setError(e.message || 'Error al cargar datos')
    } finally {
      setLoading(false)
    }
  }, [cleanCuit])

  useEffect(() => {
    fetchCached()
  }, [fetchCached])

  // Abrir consulta BCRA en nueva pestaña
  const openBcra = () => {
    window.open(
      `https://www.bcra.gob.ar/situacion-crediticia/`,
      '_blank',
      'noopener,noreferrer'
    )
  }

  // Guardar resultado manual
  const saveResult = async () => {
    if (!selectedSemaforo) return
    setSaving(true)
    setSaveSuccess(false)
    setError('')
    try {
      const res = await fetch(`/api/bcra/${cleanCuit}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          semaforo: selectedSemaforo,
          notas: notas.trim(),
          denominacion: customerName || '',
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Error al guardar')
      }
      const data = await res.json()
      setResult(data.data)
      setShowRegister(false)
      setSelectedSemaforo(null)
      setNotas('')
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (e: any) {
      setError(e.message || 'Error al guardar resultado')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-3" />
        <p className="text-gray-500 text-sm">Cargando datos BCRA...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Acción principal: consultar BCRA */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-gray-800">Central de Deudores BCRA</p>
              <p className="text-sm text-gray-500 mt-0.5">
                CUIT: {cleanCuit.replace(/(\d{2})(\d{8})(\d{1})/, '$1-$2-$3')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={openBcra} variant="default" size="sm">
                <ExternalLink className="h-4 w-4 mr-2" />
                Consultar en BCRA
              </Button>
              <Button
                onClick={() => setShowRegister(!showRegister)}
                variant="outline"
                size="sm"
              >
                <Save className="h-4 w-4 mr-2" />
                Registrar resultado
              </Button>
            </div>
          </div>

          <p className="text-xs text-gray-400 mt-3">
            Se abrirá la web del BCRA en una nueva pestaña. Ingresá el CUIT
            ({cleanCuit.replace(/(\d{2})(\d{8})(\d{1})/, '$1-$2-$3')})
            y luego registrá el resultado acá.
          </p>
        </CardContent>
      </Card>

      {/* Formulario de registro manual */}
      {showRegister && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Registrar resultado de consulta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Selector de semáforo */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Situación crediticia</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={semaforoBtnClass('verde', selectedSemaforo === 'verde')}
                  onClick={() => setSelectedSemaforo('verde')}
                >
                  <CheckCircle2 className="h-5 w-5 mx-auto mb-1 text-green-500" />
                  Normal
                </button>
                <button
                  type="button"
                  className={semaforoBtnClass('amarillo', selectedSemaforo === 'amarillo')}
                  onClick={() => setSelectedSemaforo('amarillo')}
                >
                  <AlertTriangle className="h-5 w-5 mx-auto mb-1 text-yellow-500" />
                  Con observaciones
                </button>
                <button
                  type="button"
                  className={semaforoBtnClass('rojo', selectedSemaforo === 'rojo')}
                  onClick={() => setSelectedSemaforo('rojo')}
                >
                  <XCircle className="h-5 w-5 mx-auto mb-1 text-red-500" />
                  Irregular
                </button>
              </div>
            </div>

            {/* Notas */}
            <div>
              <label className="text-sm font-medium text-gray-700">
                Notas (opcional)
              </label>
              <textarea
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                rows={3}
                placeholder="Ej: Situación 1, deuda $3.8M en 7 entidades, sin cheques rechazados"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
              />
            </div>

            {/* Botones */}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowRegister(false)
                  setSelectedSemaforo(null)
                  setNotas('')
                }}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={saveResult}
                disabled={!selectedSemaforo || saving}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Guardar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mensaje de éxito */}
      {saveSuccess && (
        <div className="flex items-center gap-2 text-green-600 text-sm bg-green-50 border border-green-200 rounded-lg px-4 py-2">
          <CheckCircle2 className="h-4 w-4" />
          Resultado registrado correctamente
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Resultado actual (último registrado) */}
      {result && result.resumen && (
        <>
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
                      {result.denominacion || customerName || '—'}
                    </p>
                  </div>
                </div>
                {result._source === 'manual' && (
                  <Badge className="bg-blue-100 text-blue-700 text-xs">
                    Registro manual
                  </Badge>
                )}
              </div>

              {/* Notas */}
              {result.notas && (
                <div className="mt-3 p-3 bg-white/60 rounded-md border border-gray-200">
                  <p className="text-sm text-gray-700">{result.notas}</p>
                </div>
              )}

              {/* Metadata */}
              {result.registradoEl && (
                <div className="flex items-center gap-1 mt-3 text-xs text-gray-400">
                  <Clock className="h-3 w-3" />
                  Registrado el{' '}
                  {new Date(result.registradoEl).toLocaleDateString('es-AR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {result.registradoPor && ` por ${result.registradoPor}`}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Sin datos previos */}
      {!result && !error && (
        <Card>
          <CardContent className="py-8 text-center text-gray-500">
            <AlertCircle className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm">No hay consultas BCRA registradas para este CUIT.</p>
            <p className="text-xs text-gray-400 mt-1">
              Consultá en la web del BCRA y registrá el resultado.
            </p>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-gray-400 text-right">
        Datos registrados manualmente desde la Central de Deudores del BCRA.
      </p>
    </div>
  )
}

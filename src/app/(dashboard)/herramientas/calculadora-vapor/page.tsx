'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  ReferenceLine,
  ReferenceDot,
} from 'recharts'
import {
  Gauge,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Info,
  FileDown,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  calcularReguladoraVapor,
  resumenTexto,
  type ResultadoCalculo,
} from '@/lib/calculoReguladoraVapor'
import { generateReguladoraVaporPDF } from '@/lib/pdf/reguladora-vapor-generator'

// ─── Helpers de formato (es-AR: coma decimal) ───────────────────────────────

const fmt = (n: number, decimales = 2) =>
  n.toLocaleString('es-AR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })

const fmtPct = (fraccion: number, decimales = 2) => `${fmt(fraccion * 100, decimales)}%`

export default function CalculadoraVaporPage() {
  const [p1Str, setP1Str] = useState('4')
  const [p2Str, setP2Str] = useState('2')
  const [qStr, setQStr] = useState('300')
  const [cliente, setCliente] = useState('')
  const [referencia, setReferencia] = useState('')

  const { resultado, error } = useMemo<{
    resultado: ResultadoCalculo | null
    error: string | null
  }>(() => {
    const p1 = parseFloat(p1Str.replace(',', '.'))
    const p2 = parseFloat(p2Str.replace(',', '.'))
    const q = parseFloat(qStr.replace(',', '.'))

    if (!Number.isFinite(p1) || !Number.isFinite(p2) || !Number.isFinite(q)) {
      return { resultado: null, error: 'Completá los tres valores para calcular.' }
    }
    try {
      return { resultado: calcularReguladoraVapor(p1, p2, q), error: null }
    } catch {
      return {
        resultado: null,
        error: 'Parámetros inválidos: se requiere P1 > P2 > 0 y Q > 0.',
      }
    }
  }, [p1Str, p2Str, qStr])

  const handleCopiarResumen = async () => {
    if (!resultado) return
    try {
      await navigator.clipboard.writeText(resumenTexto(resultado))
      toast.success('Resumen copiado al portapapeles')
    } catch {
      toast.error('No se pudo copiar al portapapeles')
    }
  }

  const handleDescargarPDF = async () => {
    if (!resultado) return
    try {
      const blob = await generateReguladoraVaporPDF({
        resultado,
        cliente: cliente.trim() || undefined,
        referencia: referencia.trim() || undefined,
        fecha: new Date(),
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const sufijo = cliente.trim()
        ? `-${cliente.trim().replace(/[^\p{L}\p{N}]+/gu, '-')}`
        : ''
      a.download = `Reguladora-Vapor${sufijo}-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('PDF descargado')
    } catch {
      toast.error('No se pudo generar el PDF')
    }
  }

  const chartData = resultado
    ? resultado.banda.map((p) => ({
        caudal: p.caudal,
        apertura: p.porcentajeApertura !== null ? p.porcentajeApertura * 100 : null,
        esDiseno: p.esDiseno,
      }))
    : []

  const puntoDiseno = chartData.find((p) => p.esDiseno)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-blue-900 dark:text-blue-100">
            Calculadora de Reguladora de Vapor
          </h1>
          <p className="text-muted-foreground">
            Selección de válvulas reductoras de presión GENEBRE 2274 / 2274N / 2275 (vapor
            saturado)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleCopiarResumen} disabled={!resultado}>
            <Copy className="mr-2 h-4 w-4" />
            Copiar resumen
          </Button>
          <Button
            onClick={handleDescargarPDF}
            disabled={!resultado}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <FileDown className="mr-2 h-4 w-4" />
            Descargar PDF
          </Button>
        </div>
      </div>

      {/* Datos de servicio + Resultado */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5 text-blue-600" />
              Condiciones de servicio
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="p1">P1 — Presión de entrada (bar g)</Label>
              <Input
                id="p1"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                value={p1Str}
                onChange={(e) => setP1Str(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p2">P2 — Presión regulada (bar g)</Label>
              <Input
                id="p2"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                value={p2Str}
                onChange={(e) => setP2Str(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="q">Q — Caudal de vapor (kg/h)</Label>
              <Input
                id="q"
                type="number"
                inputMode="decimal"
                step="10"
                min="0"
                value={qStr}
                onChange={(e) => setQStr(e.target.value)}
              />
            </div>
            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="cliente">Cliente (para el PDF)</Label>
              <Input
                id="cliente"
                placeholder="Nombre del cliente"
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="referencia">Licitación / N° de referencia</Label>
              <Input
                id="referencia"
                placeholder="Ej: Licitación 123/2026 u orden de compra"
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
              />
            </div>
            {error && (
              <p className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {error}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Resultado</CardTitle>
          </CardHeader>
          <CardContent>
            {resultado ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-sm text-muted-foreground">ΔP (P1 − P2)</p>
                    <p className="text-lg font-semibold">{fmt(resultado.deltaP)} bar</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">P1/2</p>
                    <p className="text-lg font-semibold">{fmt(resultado.p1Medio)} bar</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Régimen de flujo</p>
                    <Badge
                      variant="outline"
                      className={
                        resultado.regimen === 'SUBCRÍTICO'
                          ? 'border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300'
                          : 'border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-300'
                      }
                    >
                      {resultado.regimen}
                    </Badge>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <p className="text-sm text-muted-foreground">CV calculado</p>
                  <p className="text-2xl font-bold">{fmt(resultado.cvCalculado)}</p>
                </div>

                {resultado.seleccion ? (
                  <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/30">
                    <div className="flex flex-wrap items-center gap-4">
                      <Badge className="bg-blue-600 px-4 py-2 text-2xl font-bold hover:bg-blue-600">
                        {resultado.seleccion.medida}
                      </Badge>
                      <div>
                        <p className="font-semibold text-blue-900 dark:text-blue-100">
                          Tamaño recomendado — DN{resultado.seleccion.dn}
                        </p>
                        <p className="text-sm text-blue-800 dark:text-blue-200">
                          CV elegido: <strong>{fmt(resultado.seleccion.cv)}</strong> · % de
                          trabajo:{' '}
                          <strong>{fmtPct(resultado.seleccion.porcentajeTrabajo)}</strong>
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-lg bg-red-50 p-4 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                    <AlertTriangle className="h-6 w-6 shrink-0" />
                    <p className="font-semibold">
                      FUERA DE RANGO — evaluar válvula mayor o dos en paralelo
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">Ingresá las condiciones de servicio.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {resultado && (
        <>
          {/* Tabla de medidas */}
          <Card>
            <CardHeader>
              <CardTitle>Medidas disponibles</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Medida</TableHead>
                    <TableHead>DN</TableHead>
                    <TableHead className="text-right">Kv (m³/h)</TableHead>
                    <TableHead className="text-right">CV</TableHead>
                    <TableHead className="text-right">% de trabajo</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resultado.medidas.map((m) => {
                    const seleccionada = resultado.seleccion?.medida === m.medida
                    return (
                      <TableRow
                        key={m.medida}
                        className={
                          seleccionada ? 'bg-blue-50 font-semibold dark:bg-blue-900/30' : ''
                        }
                      >
                        <TableCell>{m.medida}</TableCell>
                        <TableCell>DN{m.dn}</TableCell>
                        <TableCell className="text-right">{fmt(m.kv, 1)}</TableCell>
                        <TableCell className="text-right">{fmt(m.cv)}</TableCell>
                        <TableCell className="text-right">
                          {fmtPct(m.porcentajeTrabajo)}
                        </TableCell>
                        <TableCell>
                          {seleccionada && (
                            <Badge className="bg-blue-600 hover:bg-blue-600">Seleccionada</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Banda de operación */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Banda de operación (20%–200% del caudal)</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">Caudal (kg/h)</TableHead>
                      <TableHead className="text-right">CV requerido</TableHead>
                      <TableHead className="text-right">% de apertura</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resultado.banda.map((p) => (
                      <TableRow
                        key={p.caudal}
                        className={
                          p.esDiseno ? 'bg-blue-50 font-semibold dark:bg-blue-900/30' : ''
                        }
                      >
                        <TableCell className="text-right">
                          {fmt(p.caudal, 0)}
                          {p.esDiseno && (
                            <Badge variant="outline" className="ml-2">
                              Diseño
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{fmt(p.cv)}</TableCell>
                        <TableCell className="text-right">
                          {p.porcentajeApertura !== null ? fmtPct(p.porcentajeApertura) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>% de apertura vs caudal</CardTitle>
              </CardHeader>
              <CardContent>
                {resultado.seleccion ? (
                  <ResponsiveContainer width="100%" height={340}>
                    <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="caudal"
                        tickFormatter={(v: number) => fmt(v, 0)}
                        label={{ value: 'Caudal (kg/h)', position: 'insideBottom', offset: -5 }}
                      />
                      <YAxis
                        tickFormatter={(v: number) => `${fmt(v, 0)}%`}
                        label={{ value: '% apertura', angle: -90, position: 'insideLeft' }}
                      />
                      <Tooltip
                        formatter={(value) => [`${fmt(Number(value))}%`, '% apertura']}
                        labelFormatter={(label) => `${fmt(Number(label), 0)} kg/h`}
                      />
                      <ReferenceLine
                        y={20}
                        stroke="#f59e0b"
                        strokeDasharray="4 4"
                        label={{ value: '20%', position: 'right', fill: '#f59e0b' }}
                      />
                      <ReferenceLine
                        y={80}
                        stroke="#f59e0b"
                        strokeDasharray="4 4"
                        label={{ value: '80%', position: 'right', fill: '#f59e0b' }}
                      />
                      <Line
                        type="monotone"
                        dataKey="apertura"
                        stroke="#2563eb"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                      {puntoDiseno && puntoDiseno.apertura !== null && (
                        <ReferenceDot
                          x={puntoDiseno.caudal}
                          y={puntoDiseno.apertura}
                          r={6}
                          fill="#2563eb"
                          stroke="#fff"
                          strokeWidth={2}
                          label={{ value: 'Diseño', position: 'top', fill: '#2563eb' }}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground">
                    Sin medida seleccionada: no se puede graficar el % de apertura.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Verificaciones */}
          <Card>
            <CardHeader>
              <CardTitle>Verificaciones (manual GENEBRE)</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {resultado.verificaciones.map((v) => (
                  <li key={v.descripcion} className="flex items-start gap-3">
                    {v.ok ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                    )}
                    <div>
                      <p className="font-medium">{v.descripcion}</p>
                      <p
                        className={
                          v.ok
                            ? 'text-sm text-muted-foreground'
                            : 'text-sm font-medium text-amber-600 dark:text-amber-400'
                        }
                      >
                        {v.detalle}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}

      {/* Nota de instalación */}
      <Card>
        <CardContent className="flex items-start gap-3 pt-6">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          <p className="text-sm text-muted-foreground">
            Instalación recomendada por GENEBRE: separador de gotas + trampa de vapor, filtro Y
            aguas arriba, manómetros y válvulas de corte a ambos lados, bypass, y válvula de
            seguridad a la salida tarada con margen sobre la presión regulada. Tramos rectos ≥ 10
            diámetros aguas arriba y abajo.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

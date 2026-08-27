'use client'

/**
 * Viandas — conteo mensual de almuerzos.
 *
 * Tiles de resumen (viandas, total $, precio editable, promedio por día),
 * historial de 12 meses en barras y la grilla semanal de carga.
 * El mes se maneja como 'YYYY-MM' y las fechas como 'YYYY-MM-DD' en UTC.
 */
import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ChevronLeft, ChevronRight, Loader2, Save, UtensilsCrossed } from 'lucide-react'
import { toast } from 'sonner'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const MESES_INICIAL = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie']
const ORDINALES = ['1ra', '2da', '3ra', '4ta', '5ta', '6ta']

interface DiaGrilla {
  fecha: string // YYYY-MM-DD
  dia: number
  delMes: boolean
}

interface SemanaGrilla {
  label: string
  dias: DiaGrilla[] // siempre 5 (lun a vie)
}

interface MesHistorial {
  mes: string // YYYY-MM
  viandas: number
  total: number
}

// Arma las semanas (lunes a viernes) que tocan el mes, como en las
// planillas: los días de meses vecinos van deshabilitados.
function armarSemanas(anio: number, mes: number): SemanaGrilla[] {
  const primero = new Date(Date.UTC(anio, mes - 1, 1))
  // Retroceder al lunes de la semana del día 1
  const offset = (primero.getUTCDay() + 6) % 7
  const cursor = new Date(primero)
  cursor.setUTCDate(cursor.getUTCDate() - offset)

  const semanas: SemanaGrilla[] = []
  while (true) {
    const dias: DiaGrilla[] = []
    for (let i = 0; i < 5; i++) {
      dias.push({
        fecha: cursor.toISOString().slice(0, 10),
        dia: cursor.getUTCDate(),
        delMes: cursor.getUTCMonth() === mes - 1,
      })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    // Saltar sábado y domingo
    cursor.setUTCDate(cursor.getUTCDate() + 2)

    // Si el mes empieza sábado o domingo, la primera semana no tiene
    // días hábiles del mes: se saltea. Al final, corta.
    if (!dias.some((d) => d.delMes)) {
      if (semanas.length === 0) continue
      break
    }
    const pad = (n: number) => String(n).padStart(2, '0')
    semanas.push({
      label: `${ORDINALES[semanas.length]} semana ${pad(dias[0].dia)} al ${pad(dias[4].dia)}`,
      dias,
    })
    if (semanas.length >= 6) break
  }
  return semanas
}

function formatARS(n: number) {
  return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
}

export default function ViandasPage() {
  const hoy = new Date()
  const hoyIso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes, setMes] = useState(hoy.getMonth() + 1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [precio, setPrecio] = useState('')
  const [cantidades, setCantidades] = useState<Record<string, string>>({})
  const [historial, setHistorial] = useState<MesHistorial[]>([])
  const [dirty, setDirty] = useState(false)

  const mesStr = `${anio}-${String(mes).padStart(2, '0')}`
  const semanas = armarSemanas(anio, mes)

  const fetchMes = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/viandas?mes=${mesStr}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      const cants: Record<string, string> = {}
      for (const d of data.dias) {
        cants[d.fecha] = String(d.cantidad)
      }
      setCantidades(cants)
      setHistorial(data.historial ?? [])
      // Precio del mes: el de los días ya cargados, o el último conocido
      const precioMes = data.dias.length > 0 ? data.dias[0].precio : data.precioDefault
      setPrecio(precioMes != null ? String(precioMes) : '')
      setDirty(false)
    } catch {
      toast.error('Error al cargar las viandas del mes')
    } finally {
      setLoading(false)
    }
  }, [mesStr])

  useEffect(() => {
    fetchMes()
  }, [fetchMes])

  const cambiarMes = (delta: number) => {
    const d = new Date(anio, mes - 1 + delta, 1)
    setAnio(d.getFullYear())
    setMes(d.getMonth() + 1)
  }

  const setCantidad = (fecha: string, valor: string) => {
    if (valor !== '' && !/^\d{1,3}$/.test(valor)) return
    setCantidades((prev) => ({ ...prev, [fecha]: valor }))
    setDirty(true)
  }

  const precioNum = parseFloat(precio) || 0

  const totalSemana = (s: SemanaGrilla) =>
    s.dias.reduce((acc, d) => acc + (parseInt(cantidades[d.fecha] || '') || 0), 0)

  const totalViandas = semanas.reduce((acc, s) => acc + totalSemana(s), 0)
  const totalMes = totalViandas * precioNum
  const diasConDatos = semanas.flatMap((s) => s.dias).filter((d) => d.delMes && (parseInt(cantidades[d.fecha] || '') || 0) > 0).length
  const promedioDia = diasConDatos > 0 ? totalViandas / diasConDatos : 0

  // Historial + mes visible al final (con los valores en pantalla)
  const serieHistorial: (MesHistorial & { actual?: boolean })[] = [
    ...historial,
    { mes: mesStr, viandas: totalViandas, total: totalMes, actual: true },
  ]
  const maxViandas = Math.max(1, ...serieHistorial.map((h) => h.viandas))

  const handleGuardar = async () => {
    if (!precioNum || precioNum <= 0) {
      toast.error('Cargá el precio de la vianda')
      return
    }
    try {
      setSaving(true)
      const dias = semanas
        .flatMap((s) => s.dias)
        .filter((d) => d.delMes)
        .map((d) => ({
          fecha: d.fecha,
          cantidad: cantidades[d.fecha]?.trim() !== '' && cantidades[d.fecha] != null
            ? parseInt(cantidades[d.fecha])
            : null,
        }))
      const res = await fetch('/api/viandas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mes: mesStr, precio: precioNum, dias }),
      })
      if (!res.ok) throw new Error()
      toast.success('Viandas guardadas')
      setDirty(false)
    } catch {
      toast.error('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UtensilsCrossed className="h-6 w-6 text-blue-600" />
            Viandas
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Conteo mensual de almuerzos — cantidad por día y precio unitario
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => cambiarMes(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="w-40 text-center font-semibold">{MESES[mes - 1]} {anio}</span>
            <Button variant="outline" size="icon" onClick={() => cambiarMes(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button onClick={handleGuardar} disabled={saving || !dirty}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Guardar
          </Button>
        </div>
      </div>

      {/* ═══ TILES DE RESUMEN ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Viandas del mes</p>
            <p className="text-3xl font-bold tabular-nums mt-1">{totalViandas}</p>
            <p className="text-xs text-muted-foreground mt-1">{diasConDatos} días con pedido</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total del mes</p>
            <p className="text-3xl font-bold tabular-nums mt-1">{formatARS(totalMes)}</p>
            <p className="text-xs text-muted-foreground mt-1">a {formatARS(precioNum)} por vianda</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Precio vianda</p>
            <div className="flex items-center gap-1 mt-1.5">
              <span className="text-xl font-semibold text-muted-foreground">$</span>
              <Input
                id="precio"
                type="number"
                min="0"
                step="100"
                className="w-28 h-9 text-xl font-bold tabular-nums"
                value={precio}
                onChange={(e) => {
                  setPrecio(e.target.value)
                  setDirty(true)
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">se aplica a todo el mes al guardar</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Promedio por día</p>
            <p className="text-3xl font-bold tabular-nums mt-1">{promedioDia ? promedioDia.toFixed(1) : '—'}</p>
            <p className="text-xs text-muted-foreground mt-1">viandas por día con pedido</p>
          </CardContent>
        </Card>
      </div>

      {/* ═══ HISTORIAL 12 MESES ═══ */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Viandas por mes — últimos 12 meses
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-[6px] h-24">
            {serieHistorial.map((h) => {
              const [hy, hm] = h.mes.split('-').map(Number)
              const altura = h.viandas > 0 ? Math.max(6, (h.viandas / maxViandas) * 88) : 2
              return (
                <div
                  key={h.mes}
                  className="flex-1 flex flex-col items-center justify-end gap-1 group"
                  title={`${MESES[hm - 1]} ${hy}: ${h.viandas} viandas · ${formatARS(h.total)}`}
                >
                  {h.actual && h.viandas > 0 && (
                    <span className="text-[10px] font-semibold tabular-nums text-gray-700">{h.viandas}</span>
                  )}
                  <div
                    style={{ height: `${altura}px` }}
                    className={`w-full max-w-[38px] rounded-t-[4px] transition-colors ${
                      h.actual ? 'bg-blue-600' : 'bg-blue-200 group-hover:bg-blue-300'
                    }`}
                  />
                  <span className={`text-[10px] ${h.actual ? 'font-bold text-gray-900' : 'text-muted-foreground'}`}>
                    {MESES_INICIAL[hm - 1]}
                    {hm === 1 ? `'${String(hy).slice(2)}` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* ═══ GRILLA SEMANAL ═══ */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-52">Semana</TableHead>
                    {DIAS_SEMANA.map((d) => (
                      <TableHead key={d} className="text-center">
                        {d}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Viandas</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {semanas.map((s, i) => (
                    <TableRow key={s.label} className={i % 2 === 1 ? 'bg-gray-50/60' : ''}>
                      <TableCell className="font-medium capitalize text-muted-foreground">{s.label}</TableCell>
                      {s.dias.map((d) =>
                        d.delMes ? (
                          <TableCell key={d.fecha} className="text-center p-1.5">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className={`text-[10px] ${d.fecha === hoyIso ? 'font-bold text-blue-600' : 'text-muted-foreground'}`}>
                                {d.dia}
                              </span>
                              <Input
                                className={`w-14 h-9 text-center tabular-nums font-medium ${
                                  d.fecha === hoyIso ? 'ring-2 ring-blue-400 ring-offset-1' : ''
                                } ${!(cantidades[d.fecha] ?? '') ? 'text-muted-foreground' : ''}`}
                                inputMode="numeric"
                                value={cantidades[d.fecha] ?? ''}
                                onChange={(e) => setCantidad(d.fecha, e.target.value)}
                                placeholder="–"
                              />
                            </div>
                          </TableCell>
                        ) : (
                          <TableCell
                            key={d.fecha}
                            className="text-center bg-gray-100/80 dark:bg-gray-800 text-muted-foreground/50 text-xs"
                          >
                            {d.dia}
                          </TableCell>
                        )
                      )}
                      <TableCell className="text-right tabular-nums font-semibold">{totalSemana(s) || ''}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {totalSemana(s) ? formatARS(totalSemana(s) * precioNum) : ''}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-50 dark:hover:bg-blue-900/20">
                    <TableCell className="font-bold" colSpan={6}>
                      Total del mes
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums text-base">
                      {totalViandas}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums text-base">
                      {formatARS(totalMes)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground mt-3">
                Dejá el día vacío si no se pidieron viandas. Los días grises pertenecen al mes
                anterior o siguiente. El precio se aplica a todo el mes al guardar.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

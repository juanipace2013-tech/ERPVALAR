'use client'

/**
 * Vacaciones — control de ausencias de empleados (réplica de la planilla
 * "Control de Ausencias y Vacaciones"): grilla empleados × días del mes.
 * Click en una celda cicla: vacío → V (vacaciones) → P (personal) →
 * E (enfermedad) → vacío. Guarda al instante.
 */
import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ChevronLeft, ChevronRight, Loader2, Plus, TreePalm } from 'lucide-react'
import { toast } from 'sonner'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const DOW = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

type Tipo = 'VACACIONES' | 'PERSONAL' | 'ENFERMEDAD'
const CICLO: (Tipo | null)[] = [null, 'VACACIONES', 'PERSONAL', 'ENFERMEDAD']
const LETRA: Record<Tipo, string> = { VACACIONES: 'V', PERSONAL: 'P', ENFERMEDAD: 'E' }
const CELDA: Record<Tipo, string> = {
  VACACIONES: 'bg-green-500 text-white',
  PERSONAL: 'bg-amber-400 text-white',
  ENFERMEDAD: 'bg-red-500 text-white',
}

interface Empleado {
  id: string
  nombre: string
  activo: boolean
  saldoVacaciones: number | null
}

export default function VacacionesPage() {
  const hoy = new Date()
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes, setMes] = useState(hoy.getMonth() + 1) // 1-12
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [ausencias, setAusencias] = useState<Map<string, Tipo>>(new Map()) // `${empleadoId}|${fecha}`
  const [resumenAnio, setResumenAnio] = useState<Map<string, number>>(new Map()) // `${empleadoId}|${tipo}`
  const [loading, setLoading] = useState(true)

  const mesStr = `${anio}-${String(mes).padStart(2, '0')}`
  const diasEnMes = new Date(anio, mes, 0).getDate()
  const dias = Array.from({ length: diasEnMes }, (_, i) => i + 1)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/vacaciones?mes=${mesStr}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setEmpleados(data.empleados)
      setAusencias(new Map(data.ausencias.map((a: { empleadoId: string; fecha: string; tipo: Tipo }) => [`${a.empleadoId}|${a.fecha}`, a.tipo])))
      setResumenAnio(new Map(data.resumenAnio.map((r: { empleadoId: string; tipo: Tipo; dias: number }) => [`${r.empleadoId}|${r.tipo}`, r.dias])))
    } catch {
      toast.error('Error al cargar vacaciones')
    } finally {
      setLoading(false)
    }
  }, [mesStr])

  useEffect(() => {
    cargar()
  }, [cargar])

  const cambiarMes = (delta: number) => {
    const d = new Date(anio, mes - 1 + delta, 1)
    setAnio(d.getFullYear())
    setMes(d.getMonth() + 1)
  }

  const toggleCelda = async (empleadoId: string, dia: number) => {
    const fecha = `${mesStr}-${String(dia).padStart(2, '0')}`
    const key = `${empleadoId}|${fecha}`
    const actual = ausencias.get(key) ?? null
    const siguiente = CICLO[(CICLO.indexOf(actual) + 1) % CICLO.length]

    // Optimista
    const prev = new Map(ausencias)
    const next = new Map(ausencias)
    if (siguiente === null) next.delete(key)
    else next.set(key, siguiente)
    setAusencias(next)

    try {
      const res = await fetch('/api/vacaciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empleadoId, fecha, tipo: siguiente }),
      })
      if (!res.ok) throw new Error()
      // Ajustar resumen anual en memoria
      const rn = new Map(resumenAnio)
      if (actual) rn.set(`${empleadoId}|${actual}`, (rn.get(`${empleadoId}|${actual}`) ?? 1) - 1)
      if (siguiente) rn.set(`${empleadoId}|${siguiente}`, (rn.get(`${empleadoId}|${siguiente}`) ?? 0) + 1)
      setResumenAnio(rn)
    } catch {
      setAusencias(prev)
      toast.error('No se pudo guardar')
    }
  }

  const editarSaldo = async (emp: Empleado) => {
    const v = window.prompt(`Días de vacaciones pendientes de ${emp.nombre}:`, emp.saldoVacaciones?.toString() ?? '')
    if (v === null) return
    const saldo = v.trim() === '' ? null : Number(v)
    if (saldo !== null && (!Number.isInteger(saldo) || saldo < 0 || saldo > 365)) {
      toast.error('Ingresá un número de días válido')
      return
    }
    try {
      const res = await fetch('/api/vacaciones', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empleadoId: emp.id, saldoVacaciones: saldo }),
      })
      if (!res.ok) throw new Error()
      setEmpleados((es) => es.map((e) => (e.id === emp.id ? { ...e, saldoVacaciones: saldo } : e)))
      toast.success('Saldo actualizado')
    } catch {
      toast.error('No se pudo guardar el saldo')
    }
  }

  const nuevoEmpleado = async () => {
    const nombre = window.prompt('Nombre del empleado:')
    if (!nombre?.trim()) return
    try {
      const res = await fetch('/api/vacaciones', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`${data.empleado.nombre} agregado`)
      cargar()
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'No se pudo crear el empleado')
    }
  }

  const esFinde = (dia: number) => {
    const dow = new Date(anio, mes - 1, dia).getDay()
    return dow === 0 || dow === 6
  }
  const esHoy = (dia: number) =>
    anio === hoy.getFullYear() && mes === hoy.getMonth() + 1 && dia === hoy.getDate()

  const activos = empleados.filter((e) => e.activo)
  const totalMes = (empleadoId: string) =>
    dias.reduce((s, d) => (ausencias.get(`${empleadoId}|${mesStr}-${String(d).padStart(2, '0')}`) ? s + 1 : s), 0)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <TreePalm className="h-7 w-7 text-green-600" />
          <div>
            <h1 className="text-2xl font-bold">Vacaciones</h1>
            <p className="text-sm text-gray-500">Control de ausencias y vacaciones de empleados</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={nuevoEmpleado}>
          <Plus className="h-4 w-4 mr-1" /> Empleado
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => cambiarMes(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <CardTitle className="w-44 text-center">{MESES[mes - 1]} {anio}</CardTitle>
              <Button variant="outline" size="icon" onClick={() => cambiarMes(1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <CardDescription className="flex items-center gap-3 text-xs">
              <span><span className="inline-block w-4 h-4 rounded bg-green-500 align-middle mr-1" />V Vacaciones</span>
              <span><span className="inline-block w-4 h-4 rounded bg-amber-400 align-middle mr-1" />P Personal</span>
              <span><span className="inline-block w-4 h-4 rounded bg-red-500 align-middle mr-1" />E Enfermedad</span>
              <span className="text-gray-400">Click en el día para marcar</span>
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="text-left pr-3 py-1 sticky left-0 bg-white min-w-[110px]">Empleado</th>
                    {dias.map((d) => (
                      <th key={d} className={`w-7 text-center font-normal text-gray-400 ${esFinde(d) ? 'bg-gray-100' : ''}`}>
                        {DOW[new Date(anio, mes - 1, d).getDay()]}
                      </th>
                    ))}
                    <th className="pl-3 text-right">Mes</th>
                    <th className="pl-3 text-right">Año V/P/E</th>
                    <th className="pl-3 text-right">Pendientes</th>
                  </tr>
                  <tr>
                    <th className="sticky left-0 bg-white" />
                    {dias.map((d) => (
                      <th key={d} className={`w-7 text-center pb-1 ${esFinde(d) ? 'bg-gray-100 text-gray-400' : ''} ${esHoy(d) ? 'text-blue-600 font-bold' : ''}`}>
                        {d}
                      </th>
                    ))}
                    <th colSpan={3} />
                  </tr>
                </thead>
                <tbody>
                  {activos.map((emp) => (
                    <tr key={emp.id} className="border-t">
                      <td className="pr-3 py-1 font-medium sticky left-0 bg-white whitespace-nowrap">{emp.nombre}</td>
                      {dias.map((d) => {
                        const fecha = `${mesStr}-${String(d).padStart(2, '0')}`
                        const tipo = ausencias.get(`${emp.id}|${fecha}`)
                        return (
                          <td key={d} className={`p-0.5 ${esFinde(d) ? 'bg-gray-100' : ''}`}>
                            <button
                              onClick={() => toggleCelda(emp.id, d)}
                              className={`w-6 h-6 rounded text-[11px] font-bold leading-none transition-colors ${
                                tipo ? CELDA[tipo] : 'hover:bg-gray-200 text-transparent hover:text-gray-400'
                              }`}
                              title={`${emp.nombre} — ${fecha}`}
                            >
                              {tipo ? LETRA[tipo] : '·'}
                            </button>
                          </td>
                        )
                      })}
                      <td className="pl-3 text-right font-semibold">{totalMes(emp.id) || ''}</td>
                      <td className="pl-3 text-right text-gray-500 whitespace-nowrap">
                        {(resumenAnio.get(`${emp.id}|VACACIONES`) ?? 0)}/
                        {(resumenAnio.get(`${emp.id}|PERSONAL`) ?? 0)}/
                        {(resumenAnio.get(`${emp.id}|ENFERMEDAD`) ?? 0)}
                      </td>
                      <td className="pl-3 text-right">
                        <button className="underline decoration-dotted text-blue-600" onClick={() => editarSaldo(emp)}>
                          {emp.saldoVacaciones != null ? `${emp.saldoVacaciones} días` : '—'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400">
        "Año V/P/E": días de Vacaciones / Personal / Enfermedad acumulados en {anio}. "Pendientes" se edita a mano
        (click sobre el valor), igual que en la planilla.
      </p>
    </div>
  )
}

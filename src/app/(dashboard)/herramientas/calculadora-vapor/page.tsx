'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
  Search,
  Plus,
  FileDown,
  Pencil,
  Trash2,
  Loader2,
  Gauge,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  descargarPDFDeCalculo,
  fmt,
  fmtPct,
  fmtFechaHora,
  urlNuevaDesdeCalculo,
  type CalculoHistorial,
} from './historial'

export default function CalculadoraVaporHistorialPage() {
  const [historial, setHistorial] = useState<CalculoHistorial[]>([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    fetch('/api/herramientas/calculadora-vapor?limit=200')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data)) setHistorial(data)
      })
      .catch(() => {})
      .finally(() => setCargando(false))
  }, [])

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return historial
    return historial.filter((c) =>
      [c.cliente, c.referencia, c.user.name, c.medida]
        .filter(Boolean)
        .some((campo) => campo!.toLowerCase().includes(q))
    )
  }, [historial, busqueda])

  const handleDescargar = async (c: CalculoHistorial) => {
    try {
      await descargarPDFDeCalculo(c)
      toast.success('PDF descargado')
    } catch {
      toast.error('No se pudo generar el PDF')
    }
  }

  const handleEliminar = async (c: CalculoHistorial) => {
    const etiqueta = c.cliente ?? c.referencia ?? `${fmtFechaHora(c.createdAt)} (${c.user.name})`
    if (!confirm(`¿Eliminar el cálculo de ${etiqueta}?\nEsta acción no se puede deshacer.`)) return
    try {
      const res = await fetch(`/api/herramientas/calculadora-vapor/${c.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error()
      setHistorial((prev) => prev.filter((x) => x.id !== c.id))
      toast.success('Cálculo eliminado del historial')
    } catch {
      toast.error('No se pudo eliminar el cálculo')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-blue-900 dark:text-blue-100">
            Calculadora de Reguladora de Vapor
          </h1>
          <p className="text-muted-foreground">
            Historial de cálculos del equipo — GENEBRE 2274 / 2274N / 2275
          </p>
        </div>
        <Button asChild className="bg-blue-600 hover:bg-blue-700">
          <Link href="/herramientas/calculadora-vapor/nueva">
            <Plus className="mr-2 h-4 w-4" />
            Nueva Simulación
          </Link>
        </Button>
      </div>

      {/* Buscador */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por cliente, licitación, usuario o medida..."
              className="pl-9"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Tabla de historial */}
      <Card>
        <CardContent className="pt-6">
          {cargando ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Cargando historial...
            </div>
          ) : filtrados.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-12 text-center">
              <Gauge className="h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">
                {historial.length === 0
                  ? 'Todavía no hay cálculos guardados. Al descargar el PDF de una simulación, el cálculo queda registrado acá para todo el equipo.'
                  : 'No hay cálculos que coincidan con la búsqueda.'}
              </p>
              {historial.length === 0 && (
                <Button asChild className="bg-blue-600 hover:bg-blue-700">
                  <Link href="/herramientas/calculadora-vapor/nueva">
                    <Plus className="mr-2 h-4 w-4" />
                    Hacer la primera simulación
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Licitación / Ref.</TableHead>
                  <TableHead className="text-right">P1 (bar)</TableHead>
                  <TableHead className="text-right">P2 (bar)</TableHead>
                  <TableHead className="text-right">Q (kg/h)</TableHead>
                  <TableHead>Régimen</TableHead>
                  <TableHead>Medida</TableHead>
                  <TableHead className="text-right">% trabajo</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap">
                      {fmtFechaHora(c.createdAt)}
                    </TableCell>
                    <TableCell>{c.user.name}</TableCell>
                    <TableCell className="font-medium">{c.cliente ?? '—'}</TableCell>
                    <TableCell>{c.referencia ?? '—'}</TableCell>
                    <TableCell className="text-right">{fmt(c.p1)}</TableCell>
                    <TableCell className="text-right">{fmt(c.p2)}</TableCell>
                    <TableCell className="text-right">{fmt(c.q, 0)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          c.regimen === 'SUBCRÍTICO'
                            ? 'border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300'
                            : 'border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-300'
                        }
                      >
                        {c.regimen}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {c.medida ? (
                        <Badge className="bg-blue-600 hover:bg-blue-600">{c.medida}</Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-red-300 text-red-700 dark:border-red-700 dark:text-red-300"
                        >
                          Fuera de rango
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.porcentajeTrabajo !== null ? fmtPct(c.porcentajeTrabajo) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDescargar(c)}
                          title="Descargar PDF"
                        >
                          <FileDown className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" asChild title="Abrir en la calculadora">
                          <Link href={urlNuevaDesdeCalculo(c)}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEliminar(c)}
                          title="Eliminar del historial"
                          className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

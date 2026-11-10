'use client'

/**
 * Recibos de cobro a clientes registrados desde el ERP en Colppy.
 * API: GET /api/cobros. Ver src/lib/cobros-colppy/registrar.ts.
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { HandCoins, Loader2, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'

interface CobroListado {
  id: string
  fecha: string
  estado: string
  numero: string | null
  cliente: { id: string; nombre: string }
  totalCobrado: number
  comprobantes: Array<{ numero: string; importe: number }>
  medios: Array<{ cuenta: string; importe: number }>
  error: string | null
  creadoPor: string
}

const ESTADOS: Record<string, { label: string; className: string }> = {
  REGISTRADA: { label: 'Registrado', className: 'bg-green-100 text-green-800 border border-green-300' },
  ERROR: { label: 'Error', className: 'bg-red-100 text-red-800 border border-red-300' },
  INCIERTO: { label: 'Incierto', className: 'bg-amber-100 text-amber-800 border border-amber-300' },
  REGISTRANDO: { label: 'Registrando', className: 'bg-gray-100 text-gray-700 border border-gray-300' },
}

/** YYYY-MM-DD → DD/MM/YYYY sin pasar por Date (evita el corrimiento de huso) */
function fechaCorta(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s
}

export default function CobrosPage() {
  const [cobros, setCobros] = useState<CobroListado[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [verificando, setVerificando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const r = await fetch('/api/cobros?limit=200')
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setError(d?.error || `No se pudieron leer los cobros (HTTP ${r.status})`)
        return
      }
      setCobros(Array.isArray(d?.cobros) ? d.cobros : [])
    } catch {
      setError('No se pudo conectar con el servidor')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function verificar(id: string) {
    setVerificando(id)
    try {
      const r = await fetch(`/api/cobros/${id}/verificar`, { method: 'POST' })
      const d = await r.json().catch(() => null)
      if (!r.ok) toast.error(d?.error || `No se pudo verificar (HTTP ${r.status})`)
      else if (d?.estado === 'REGISTRADA') toast.success('Colppy tiene el cobro: quedó registrado')
      else toast.message(d?.error || 'Sin cambios')
      await cargar()
    } finally {
      setVerificando(null)
    }
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <HandCoins className="h-6 w-6" />
            Cobros
          </h1>
          <p className="text-sm text-muted-foreground">Recibos cargados desde el ERP en Colppy</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={cargar} disabled={cargando}>
            <RefreshCw className={`mr-2 h-4 w-4 ${cargando ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
          <Button asChild>
            <Link href="/cobros/nuevo">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo cobro
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {cargando && cobros.length === 0 ? (
            <div className="flex items-center justify-center p-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Cargando…
            </div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-red-700">{error}</div>
          ) : cobros.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              Todavía no se cargó ningún cobro desde el ERP. Los recibos hechos directamente en Colppy no aparecen acá.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Recibo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Comprobantes</TableHead>
                  <TableHead>Medios</TableHead>
                  <TableHead className="text-right">Total cobrado</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {cobros.map((c) => {
                  const e = ESTADOS[c.estado] ?? ESTADOS.REGISTRANDO
                  return (
                    <TableRow key={c.id}>
                      <TableCell>{fechaCorta(c.fecha)}</TableCell>
                      <TableCell className="font-medium">{c.numero ?? '—'}</TableCell>
                      <TableCell>{c.cliente.nombre}</TableCell>
                      <TableCell className="text-sm">{c.comprobantes.map((x) => x.numero).join(', ') || '—'}</TableCell>
                      <TableCell className="text-sm">{c.medios.map((x) => x.cuenta).join(', ') || '—'}</TableCell>
                      <TableCell className="text-right">{formatCurrency(c.totalCobrado)}</TableCell>
                      <TableCell>
                        <Badge className={e.className}>{e.label}</Badge>
                        {c.error && <div className="mt-1 max-w-xs text-xs text-muted-foreground">{c.error}</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        {(c.estado === 'INCIERTO' || c.estado === 'REGISTRANDO') && (
                          <Button variant="outline" size="sm" disabled={verificando === c.id} onClick={() => verificar(c.id)}>
                            {verificando === c.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Verificar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

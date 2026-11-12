'use client'

/**
 * Recibos de cobro cargados desde el ERP (de un cliente o de todos), con el
 * botón para bajar el recibo en PDF y para verificar los inciertos.
 * API: GET /api/cobros, POST /api/cobros/[id]/verificar.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FileDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'

interface CobroListado {
  id: string
  fecha: string
  estado: string
  numero: string | null
  cliente: { id: string; nombre: string; cuit?: string | null; direccion?: string | null; localidad?: string | null; condicionIva?: string | null }
  descripcion?: string | null
  totalAplicado: number
  totalCobrado: number
  comprobantes: Array<{ numero: string; tipo: string; total: number; saldoAnterior: number; importe: number; tcFactura: number | null; tcCobro: number | null }>
  medios: Array<{ medio?: string; cuenta: string; importe: number }>
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
function fechaIso(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s
}

/** Recibos cargados desde el ERP (de un cliente o de todos) */
export default function RecibosErp({ clienteId, version, conCliente }: { clienteId?: string; version: number; conCliente?: boolean }) {
  const [cobros, setCobros] = useState<CobroListado[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [verificando, setVerificando] = useState<string | null>(null)
  const [bajando, setBajando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const r = await fetch(`/api/cobros?limit=100${clienteId ? `&customerId=${encodeURIComponent(clienteId)}` : ''}`)
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
  }, [clienteId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y recarga después de un cobro
    void cargar()
  }, [cargar, version])

  /** Arma el PDF del recibo (para mandar al cliente) y lo descarga */
  async function descargarRecibo(c: CobroListado) {
    if (!c.numero) return
    setBajando(c.id)
    try {
      const { generateReciboPDF } = await import('@/lib/pdf/recibo-generator')
      const blob = await generateReciboPDF({
        numero: c.numero,
        fecha: c.fecha,
        cliente: c.cliente,
        comprobantes: c.comprobantes,
        medios: c.medios.map((m) => ({ medio: m.medio === 'Echeqs' ? 'E-cheq' : m.medio || 'Transferencia', cuenta: m.medio === 'Echeqs' ? m.cuenta.replace(/^E-cheq /, '') : m.cuenta, importe: m.importe })),
        totalAplicado: c.totalAplicado,
        totalCobrado: c.totalCobrado,
        descripcion: c.descripcion,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Recibo_${c.numero}_${c.cliente.nombre.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (e) {
      toast.error(`No se pudo armar el recibo: ${(e as Error).message}`)
    } finally {
      setBajando(null)
    }
  }

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

  if (cargando && cobros.length === 0) {
    return (
      <div className="flex items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Cargando…
      </div>
    )
  }
  if (error) return <div className="p-8 text-center text-sm text-red-700">{error}</div>
  if (cobros.length === 0) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Todavía no se cargó ningún cobro desde el ERP{clienteId ? ' para este cliente' : ''}. Los recibos hechos directamente en Colppy no aparecen acá.
      </div>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fecha</TableHead>
          <TableHead>Recibo</TableHead>
          {conCliente && <TableHead>Cliente</TableHead>}
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
              <TableCell>{fechaIso(c.fecha)}</TableCell>
              <TableCell className="font-medium">{c.numero ?? '—'}</TableCell>
              {conCliente && <TableCell>{c.cliente.nombre}</TableCell>}
              <TableCell className="text-sm">{c.comprobantes.map((x) => x.numero).join(', ') || '—'}</TableCell>
              <TableCell className="text-sm">{c.medios.map((x) => x.cuenta).join(', ') || '—'}</TableCell>
              <TableCell className="text-right">{formatCurrency(c.totalCobrado)}</TableCell>
              <TableCell>
                <Badge className={e.className}>{e.label}</Badge>
                {c.error && <div className="mt-1 max-w-xs text-xs text-muted-foreground">{c.error}</div>}
              </TableCell>
              <TableCell className="text-right">
                {c.estado === 'REGISTRADA' && c.numero && (
                  <Button variant="outline" size="sm" disabled={bajando === c.id} onClick={() => descargarRecibo(c)} title="Descargar el recibo en PDF para mandar al cliente">
                    {bajando === c.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
                    Recibo
                  </Button>
                )}
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
  )
}

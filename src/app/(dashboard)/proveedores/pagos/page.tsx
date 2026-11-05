'use client'

/**
 * Órdenes de pago a proveedores registradas desde el ERP en Colppy.
 * API: GET /api/pagos-proveedores. Ver src/lib/pagos-proveedores/registrar.ts.
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Banknote, Loader2, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'

interface OrdenListado {
  id: string
  fecha: string
  estado: string
  numero: string | null
  colppyPaymentId: string | null
  proveedor: { id: string; nombre: string }
  totalFacturas: number
  retencion: number
  totalPagado: number
  facturas: number
  error: string | null
  creadaPor: string
  creadaEl: string
}

const ESTADOS: Record<string, { label: string; className: string }> = {
  REGISTRADA: { label: 'Registrada', className: 'bg-green-100 text-green-800 border border-green-300' },
  ERROR: { label: 'Error', className: 'bg-red-100 text-red-800 border border-red-300' },
  INCIERTO: { label: 'Incierto', className: 'bg-amber-100 text-amber-800 border border-amber-300' },
  REGISTRANDO: { label: 'Registrando', className: 'bg-gray-100 text-gray-700 border border-gray-300' },
}

/** YYYY-MM-DD → DD/MM/YYYY sin pasar por Date (evita el corrimiento de huso) */
function fechaCorta(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s
}

export default function PagosProveedoresPage() {
  const router = useRouter()
  const [ordenes, setOrdenes] = useState<OrdenListado[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const r = await fetch('/api/pagos-proveedores?limit=200')
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setError(d?.error || `No se pudieron leer las órdenes (HTTP ${r.status})`)
        return
      }
      setOrdenes(Array.isArray(d?.ordenes) ? d.ordenes : [])
    } catch (e) {
      setError(`No se pudieron leer las órdenes: ${(e as Error).message}`)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pagos a proveedores</h1>
          <p className="text-muted-foreground">Órdenes de pago armadas en el ERP y registradas en Colppy.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={cargar} disabled={cargando}>
            <RefreshCw className={`mr-2 h-4 w-4 ${cargando ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
          <Button asChild>
            <Link href="/proveedores/pagos/nueva">
              <Plus className="mr-2 h-4 w-4" />
              Nueva orden de pago
            </Link>
          </Button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

      <Card>
        <CardContent className="p-0">
          {cargando && ordenes.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : ordenes.length === 0 ? (
            <div className="py-12 text-center">
              <Banknote className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-600">Todavía no hay órdenes de pago cargadas desde el ERP</p>
              <Button asChild className="mt-4">
                <Link href="/proveedores/pagos/nueva">
                  <Plus className="mr-2 h-4 w-4" />
                  Nueva orden de pago
                </Link>
              </Button>
            </div>
          ) : (
            <div className={`overflow-x-auto ${cargando ? 'pointer-events-none opacity-50' : ''}`}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Número</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead className="text-right">Facturas</TableHead>
                    <TableHead className="text-right">Total pagado</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Creada por</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordenes.map((o) => {
                    const est = ESTADOS[o.estado] ?? { label: o.estado, className: 'bg-gray-100 text-gray-700' }
                    return (
                      <TableRow key={o.id} className="cursor-pointer hover:bg-gray-50" onClick={() => router.push(`/proveedores/pagos/${o.id}`)}>
                        <TableCell className="whitespace-nowrap">{fechaCorta(o.fecha)}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono font-semibold">{o.numero ?? '—'}</TableCell>
                        <TableCell className="font-medium">{o.proveedor.nombre}</TableCell>
                        <TableCell className="text-right">{o.facturas}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-semibold">{formatCurrency(o.totalPagado)}</TableCell>
                        <TableCell>
                          <Badge className={est.className} title={o.error ?? undefined}>
                            {est.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-gray-600">{o.creadaPor}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

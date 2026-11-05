'use client'

/**
 * Detalle de una orden de pago a proveedor.
 * API: GET /api/pagos-proveedores/[id] y POST /api/pagos-proveedores/[id]/verificar
 * (para una orden INCIERTA o trabada en REGISTRANDO: busca el número en Colppy).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Loader2, SearchCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDateTimeAR } from '@/lib/utils'

interface OrdenDetalle {
  id: string
  fecha: string
  estado: string
  numero: string | null
  colppyPaymentId: string | null
  proveedor: { id: string; nombre: string; cuit: string | null }
  totalFacturas: number
  retencion: { regimen: string | null; base: number; importe: number; calculada: number }
  totalPagado: number
  descripcion: string | null
  error: string | null
  registradaEl: string | null
  creadaPor: string
  creadaEl: string
  facturas: Array<{
    idFacturaColppy: string
    numero: string
    total: number
    saldoAnterior: number
    importe: number
    neto: number
    purchaseInvoiceId: string | null
  }>
  medios: Array<{ medio: string; cuenta: string; cuentaContable: string | null; importe: number; cheque?: { numero: string; fecha: string | null } | null }>
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

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="font-medium">{children}</div>
    </div>
  )
}

export default function OrdenPagoDetallePage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [orden, setOrden] = useState<OrdenDetalle | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [verificando, setVerificando] = useState(false)
  const enVuelo = useRef(false)

  const cargar = useCallback(async () => {
    if (!id) return
    setCargando(true)
    setError(null)
    try {
      const r = await fetch(`/api/pagos-proveedores/${encodeURIComponent(id)}`)
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setError(d?.error || `No se pudo leer la orden (HTTP ${r.status})`)
        return
      }
      setOrden(d as OrdenDetalle)
    } catch (e) {
      setError(`No se pudo leer la orden: ${(e as Error).message}`)
    } finally {
      setCargando(false)
    }
  }, [id])

  useEffect(() => {
    cargar()
  }, [cargar])

  const verificar = async () => {
    if (!id || enVuelo.current) return
    enVuelo.current = true
    setVerificando(true)
    try {
      const r = await fetch(`/api/pagos-proveedores/${encodeURIComponent(id)}/verificar`, { method: 'POST' })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        toast.error('No se pudo verificar en Colppy', { description: d?.error || `HTTP ${r.status}`, duration: 15000 })
      } else if (d?.estado === 'REGISTRADA') {
        toast.success(`Colppy tiene la orden ${d.numero ?? ''}: quedó registrada`)
      } else if (d?.estado === 'ERROR') {
        toast.warning('Colppy no tiene esta orden: no se creó', { description: 'Podés armarla de nuevo desde "Nueva orden de pago".', duration: 15000 })
      } else {
        toast.info('La orden sigue sin confirmar', { description: d?.error ?? undefined, duration: 15000 })
      }
    } catch (e) {
      toast.error('No se pudo verificar en Colppy', { description: (e as Error).message })
    } finally {
      enVuelo.current = false
      setVerificando(false)
    }
    await cargar()
  }

  if (cargando && !orden) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!orden) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link href="/proveedores/pagos">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a Pagos
          </Link>
        </Button>
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error ?? 'Orden no encontrada'}</div>
      </div>
    )
  }

  const est = ESTADOS[orden.estado] ?? { label: orden.estado, className: 'bg-gray-100 text-gray-700' }
  const puedeVerificar = orden.estado === 'INCIERTO' || orden.estado === 'REGISTRANDO'
  const ret = orden.retencion
  const retCorregida = Math.abs(ret.importe - ret.calculada) > 0.005
  const totalMedios = orden.medios.reduce((a, m) => a + m.importe, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/proveedores/pagos" aria-label="Volver a Pagos">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="flex flex-wrap items-center gap-3 text-3xl font-bold tracking-tight">
              Orden de pago {orden.numero ?? '(sin número)'}
              <Badge className={est.className}>{est.label}</Badge>
            </h1>
            <p className="text-muted-foreground">{orden.proveedor.nombre}</p>
          </div>
        </div>
        {puedeVerificar && (
          <Button onClick={verificar} disabled={verificando}>
            {verificando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SearchCheck className="mr-2 h-4 w-4" />}
            Verificar en Colppy
          </Button>
        )}
      </div>

      {orden.estado === 'INCIERTO' && (
        <div className="flex gap-3 rounded-lg border-2 border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">No sabemos si Colppy creó este pago.</p>
            <p>NO lo vuelvas a cargar. Tocá «Verificar en Colppy»: busca el número en los pagos del proveedor.</p>
          </div>
        </div>
      )}
      {orden.estado === 'REGISTRANDO' && (
        <div className="rounded-lg border border-gray-300 bg-gray-50 p-4 text-sm text-gray-800">
          La orden se está registrando o quedó a medio registrar. Si pasaron más de 15 minutos, tocá «Verificar en Colppy».
        </div>
      )}
      {orden.error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Último error</p>
          <p className="whitespace-pre-wrap break-words">{orden.error}</p>
        </div>
      )}
      {error && <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

      <Card>
        <CardHeader>
          <CardTitle>Datos</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Dato label="Proveedor">
            {orden.proveedor.nombre}
            {orden.proveedor.cuit && <span className="block text-xs text-muted-foreground">CUIT {orden.proveedor.cuit}</span>}
          </Dato>
          <Dato label="Fecha del pago">{fechaCorta(orden.fecha)}</Dato>
          <Dato label="Número">
            <span className="font-mono">{orden.numero ?? '—'}</span>
          </Dato>
          <Dato label="idPago en Colppy">
            <span className="font-mono">{orden.colppyPaymentId ?? '—'}</span>
          </Dato>
          <Dato label="Creada por">
            {orden.creadaPor}
            <span className="block text-xs text-muted-foreground">{formatDateTimeAR(orden.creadaEl)}</span>
          </Dato>
          <Dato label="Registrada en Colppy">{orden.registradaEl ? formatDateTimeAR(orden.registradaEl) : '—'}</Dato>
          <Dato label="Total facturas">{formatCurrency(orden.totalFacturas)}</Dato>
          <Dato label="Total pagado">
            <span className="text-lg font-bold">{formatCurrency(orden.totalPagado)}</span>
          </Dato>
          {orden.descripcion && (
            <div className="col-span-full">
              <p className="text-xs text-muted-foreground">Descripción</p>
              <p className="whitespace-pre-wrap">{orden.descripcion}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Facturas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {orden.facturas.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Sin facturas guardadas (la orden no llegó a armarse).</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead className="text-right">Total factura</TableHead>
                    <TableHead className="text-right">Saldo anterior</TableHead>
                    <TableHead className="text-right">Importe pagado</TableHead>
                    <TableHead className="text-right">Neto (sin IVA)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orden.facturas.map((f) => (
                    <TableRow key={f.idFacturaColppy}>
                      <TableCell className="whitespace-nowrap font-mono">
                        {f.purchaseInvoiceId ? (
                          <Link href={`/proveedores/facturas-compra/${f.purchaseInvoiceId}`} className="text-blue-600 hover:underline">
                            {f.numero}
                          </Link>
                        ) : (
                          f.numero
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">{formatCurrency(f.total)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">{formatCurrency(f.saldoAnterior)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">{formatCurrency(f.importe)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-muted-foreground">{formatCurrency(f.neto)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Retención de Ganancias</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {ret.regimen ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Régimen</span>
                  <span>{ret.regimen}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Base acumulada del mes</span>
                  <span className="font-mono">{formatCurrency(ret.base)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Retenido</span>
                  <span className="font-mono font-semibold">{formatCurrency(ret.importe)}</span>
                </div>
                {retCorregida && (
                  <p className="text-amber-800">Corregida a mano: el cálculo daba {formatCurrency(ret.calculada)}.</p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">Sin retención.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Medios de pago</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {orden.medios.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">Sin medios guardados.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Medio</TableHead>
                      <TableHead>Cuenta</TableHead>
                      <TableHead className="text-right">Importe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orden.medios.map((m, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          {m.medio === 'Echeqs' ? 'E-cheq' : m.medio}
                          {m.cheque && (
                            <span className="block text-xs text-muted-foreground">
                              Nº {m.cheque.numero}
                              {m.cheque.fecha ? ` · paga el ${m.cheque.fecha.split('-').reverse().join('/')}` : ''}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {m.cuenta}
                          {m.cuentaContable && <span className="block text-xs text-muted-foreground">{m.cuentaContable}</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono">{formatCurrency(m.importe)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={2}>Total</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{formatCurrency(totalMedios)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

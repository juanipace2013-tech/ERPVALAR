'use client'

/**
 * Panel del proveedor elegido en Proveedores → Gestión (como Colppy):
 * pestañas "Facturas adeudadas" (en vivo de Colppy), "Pagos" (órdenes del ERP)
 * e "Información general", y abajo "Agregar factura" / "Agregar pago", que
 * abren los formularios en un panel lateral sin salir de la pantalla.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertTriangle, Banknote, ExternalLink, FilePlus2, Loader2, RefreshCw, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { formatCurrency } from '@/lib/utils'
import type { ImpagaParaPantalla } from '@/lib/pagos-proveedores/registrar'
import NuevaOrdenPagoForm from './NuevaOrdenPagoForm'
import NuevaFacturaCompraForm from './NuevaFacturaCompraForm'

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface ProveedorDelListado {
  id: string
  name: string
  legalName: string | null
  taxId: string | null
  balance: number | string
  discount: number | string
  status: string
  isPreferred: boolean
  brands: string[]
  colppyId?: string | null
  buyerUser: { id: string; name: string; email: string } | null
}

interface OrdenDelProveedor {
  id: string
  fecha: string
  estado: string
  numero: string | null
  totalPagado: number
  facturas: number
  error: string | null
  creadaPor: string
}

type Carga<T> =
  | { estado: 'cargando' }
  | { estado: 'ok'; data: T }
  | { estado: 'error'; status: number; mensaje: string; codigo?: string }

const ESTADOS_OP: Record<string, { label: string; className: string }> = {
  REGISTRADA: { label: 'Registrada', className: 'bg-green-100 text-green-800 border border-green-300' },
  ERROR: { label: 'Error', className: 'bg-red-100 text-red-800 border border-red-300' },
  INCIERTO: { label: 'Incierto', className: 'bg-amber-100 text-amber-800 border border-amber-300' },
  REGISTRANDO: { label: 'Registrando', className: 'bg-gray-100 text-gray-700 border border-gray-300' },
}

const ESTADOS_PROVEEDOR: Record<string, string> = { ACTIVE: 'Activo', INACTIVE: 'Inactivo', BLOCKED: 'Bloqueado' }

// ── Utilidades ──────────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** YYYY-MM-DD o DD-MM-YYYY (Colppy) → YYYY-MM-DD para ordenar ('' si no se entiende) */
function aIso(s: string | null | undefined): string {
  if (!s) return ''
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const ar = /^(\d{2})[-/](\d{2})[-/](\d{4})/.exec(s)
  if (ar) return `${ar[3]}-${ar[2]}-${ar[1]}`
  return ''
}

/** YYYY-MM-DD o DD-MM-YYYY → DD/MM/YYYY */
function fechaCorta(s: string | null | undefined): string {
  const iso = aIso(s)
  if (!iso) return s || '—'
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

/** Hoy en Argentina (UTC-3), YYYY-MM-DD */
function hoyAr(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

async function leer<T>(url: string): Promise<Carga<T>> {
  try {
    const r = await fetch(url)
    const d = await r.json().catch(() => null)
    if (r.ok && d) return { estado: 'ok', data: d as T }
    const mensaje =
      typeof d?.error === 'string' && d.error
        ? d.error
        : r.status === 403
          ? 'No tenés permisos para ver esto'
          : `Error HTTP ${r.status}`
    return { estado: 'error', status: r.status, mensaje, codigo: typeof d?.codigo === 'string' ? d.codigo : undefined }
  } catch (e) {
    return { estado: 'error', status: 0, mensaje: `No se pudo conectar: ${(e as Error).message}` }
  }
}

// ── Panel ───────────────────────────────────────────────────────────────────

export default function ProveedorPanel({
  proveedor,
  onCambioSaldo,
  onSaldoColppy,
}: {
  proveedor: ProveedorDelListado
  /** Se llama después de guardar una factura o registrar un pago (para refrescar la lista) */
  onCambioSaldo?: () => void
  /** Saldo en vivo de Colppy (Σ adeudadas): la lista lo muestra en vez del del último sync diario */
  onSaldoColppy?: (supplierId: string, saldo: number) => void
}) {
  const [tab, setTab] = useState('adeudadas')
  const [adeudadas, setAdeudadas] = useState<Carga<{ colppyId: string; impagas: ImpagaParaPantalla[]; saldo: number }>>({ estado: 'cargando' })
  const [pagos, setPagos] = useState<Carga<{ ordenes: OrdenDelProveedor[] }>>({ estado: 'cargando' })
  const [tildadas, setTildadas] = useState<Set<string>>(new Set())
  const reqAdeudadas = useRef(0)
  const reqPagos = useRef(0)

  const [facturaAbierta, setFacturaAbierta] = useState(false)
  const [pagoAbierto, setPagoAbierto] = useState(false)
  const [pagoOcupado, setPagoOcupado] = useState(false)
  const [facturaOcupada, setFacturaOcupada] = useState(false)
  const [facturaSucia, setFacturaSucia] = useState(false)

  /** Lee las adeudadas (el estado "cargando" lo pone quien llama, si hace falta) */
  const pedirAdeudadas = async () => {
    const mio = ++reqAdeudadas.current
    const r = await leer<{ colppyId: string; impagas: ImpagaParaPantalla[]; saldo: number }>(
      `/api/pagos-proveedores/adeudadas?supplierId=${encodeURIComponent(proveedor.id)}`
    )
    if (mio !== reqAdeudadas.current) return
    setAdeudadas(r)
    if (r.estado === 'ok') onSaldoColppy?.(proveedor.id, r.data.saldo)
    // Se conservan solo las tildadas que siguen pagables
    if (r.estado === 'ok') {
      const pagables = new Set(r.data.impagas.filter((f) => f.pagable && f.saldo > 0).map((f) => f.idFactura))
      setTildadas((t) => new Set([...t].filter((id) => pagables.has(id))))
    } else {
      setTildadas(new Set())
    }
  }

  const pedirPagos = async () => {
    const mio = ++reqPagos.current
    const r = await leer<{ ordenes: OrdenDelProveedor[] }>(`/api/pagos-proveedores?supplierId=${encodeURIComponent(proveedor.id)}&limit=50`)
    if (mio === reqPagos.current) setPagos(r)
  }

  const cargarAdeudadas = () => {
    setAdeudadas({ estado: 'cargando' })
    void pedirAdeudadas()
  }

  const cargarPagos = () => {
    setPagos({ estado: 'cargando' })
    void pedirPagos()
  }

  // El panel se monta con key = proveedor y arranca en "cargando"
  useEffect(() => {
    void pedirAdeudadas()
    void pedirPagos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedor.id])

  // ── Derivados ───────────────────────────────────────────────────────────

  const filas = useMemo(() => {
    if (adeudadas.estado !== 'ok') return []
    const orden = [...adeudadas.data.impagas].sort((a, b) => {
      const fa = aIso(a.vencimiento)
      const fb = aIso(b.vencimiento)
      if (fa !== fb) return fa < fb ? -1 : 1
      return a.nroFactura.localeCompare(b.nroFactura)
    })
    let acumulado = 0
    return orden.map((f) => {
      acumulado = r2(acumulado + f.saldo)
      return { ...f, pagado: r2(f.totalFactura - f.saldo), acumulado }
    })
  }, [adeudadas])

  const hoy = useMemo(() => hoyAr(), [])
  const pagables = filas.filter((f) => f.pagable && f.saldo > 0)
  const totalTildado = r2(filas.filter((f) => tildadas.has(f.idFactura)).reduce((a, f) => a + f.saldo, 0))
  const todasTildadas = pagables.length > 0 && pagables.every((f) => tildadas.has(f.idFactura))

  const sinPermisoPagos = (adeudadas.estado === 'error' && adeudadas.status === 403) || (pagos.estado === 'error' && pagos.status === 403)
  const sinColppy = adeudadas.estado === 'error' && adeudadas.codigo === 'SIN_COLPPY'
  const saldoColppy = adeudadas.estado === 'ok' ? adeudadas.data.saldo : null

  const tildar = (id: string, si: boolean) =>
    setTildadas((t) => {
      const n = new Set(t)
      if (si) n.add(id)
      else n.delete(id)
      return n
    })

  const tildarTodas = (si: boolean) => setTildadas(si ? new Set(pagables.map((f) => f.idFactura)) : new Set())

  // ── Acciones ────────────────────────────────────────────────────────────

  const cerrarPago = (abierto: boolean) => {
    if (!abierto && pagoOcupado) {
      toast.warning('Esperá: el pago se está registrando o no sabemos cómo terminó. Resolvelo antes de cerrar.')
      return
    }
    setPagoAbierto(abierto)
    if (!abierto) {
      setPagoOcupado(false)
      // Una orden que terminó en ERROR o INCIERTA igual queda en la pestaña Pagos
      cargarPagos()
      cargarAdeudadas()
    }
  }

  const cerrarFactura = (abierto: boolean) => {
    if (abierto) {
      setFacturaAbierta(true)
      return
    }
    if (facturaOcupada) {
      toast.warning('Esperá: la factura se está guardando o leyendo.')
      return
    }
    if (facturaSucia && !window.confirm('¿Descartar la factura que estás cargando?')) return
    setFacturaAbierta(false)
    setFacturaSucia(false)
  }

  const alRegistrarPago = () => {
    setPagoOcupado(false)
    setPagoAbierto(false)
    setTildadas(new Set())
    setTab('pagos')
    cargarAdeudadas()
    cargarPagos()
    onCambioSaldo?.()
  }

  const alGuardarFactura = () => {
    setFacturaOcupada(false)
    setFacturaSucia(false)
    setFacturaAbierta(false)
    cargarAdeudadas()
    onCambioSaldo?.()
  }

  const nombre = proveedor.legalName || proveedor.name

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Card className="border-blue-200">
      <CardHeader className="border-b pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 truncate text-xl font-semibold text-blue-900">
              {proveedor.isPreferred && <Star className="h-4 w-4 shrink-0 fill-yellow-500 text-yellow-500" />}
              <span className="truncate">{proveedor.name}</span>
            </h2>
            <p className="text-sm text-muted-foreground">
              {proveedor.legalName && proveedor.legalName !== proveedor.name ? `${proveedor.legalName} · ` : ''}
              {proveedor.taxId ? `CUIT ${proveedor.taxId}` : 'Sin CUIT'}
            </p>
            <Link href={`/proveedores/${proveedor.id}`} className="mt-1 inline-flex items-center gap-1 text-sm text-blue-700 hover:underline">
              Ver ficha
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Saldo según Colppy</p>
            {saldoColppy !== null ? (
              <p className="font-mono text-2xl font-bold">{formatCurrency(saldoColppy)}</p>
            ) : adeudadas.estado === 'cargando' ? (
              <Loader2 className="ml-auto h-5 w-5 animate-spin text-gray-400" />
            ) : (
              <>
                <p className="font-mono text-2xl font-bold text-muted-foreground">{formatCurrency(proveedor.balance)}</p>
                <p className="text-[11px] text-muted-foreground">último sync</p>
              </>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <Tabs value={tab} onValueChange={setTab}>
          <div className="border-b px-4 pt-3">
            <TabsList className="bg-blue-50">
              <TabsTrigger value="adeudadas" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                Facturas adeudadas
              </TabsTrigger>
              <TabsTrigger value="pagos" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                Pagos
              </TabsTrigger>
              <TabsTrigger value="info" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                Información general
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Facturas adeudadas */}
          <TabsContent value="adeudadas" className="m-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                {adeudadas.estado === 'ok'
                  ? filas.length === 0
                    ? 'No le debemos nada en Colppy.'
                    : `${filas.length} comprobante${filas.length === 1 ? '' : 's'} · en vivo de Colppy`
                  : adeudadas.estado === 'cargando'
                    ? 'Leyendo Colppy…'
                    : ''}
              </span>
              <Button variant="ghost" size="sm" onClick={cargarAdeudadas} disabled={adeudadas.estado === 'cargando'}>
                <RefreshCw className={`mr-1 h-4 w-4 ${adeudadas.estado === 'cargando' ? 'animate-spin' : ''}`} />
                Refrescar
              </Button>
            </div>

            {adeudadas.estado === 'cargando' && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
              </div>
            )}

            {adeudadas.estado === 'error' && (
              <div className={`mx-4 mb-4 rounded-lg border p-3 text-sm ${sinColppy || adeudadas.status === 403 ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-red-300 bg-red-50 text-red-800'}`}>
                <p className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {adeudadas.status === 403
                    ? 'Sin permisos para ver las facturas adeudadas'
                    : sinColppy
                      ? 'Este proveedor no está vinculado a Colppy'
                      : 'No se pudieron leer las facturas de Colppy'}
                </p>
                <p className="mt-1 pl-6">{adeudadas.mensaje}</p>
              </div>
            )}

            {adeudadas.estado === 'ok' && filas.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-blue-50">
                      <TableHead className="w-10">
                        {!sinPermisoPagos && (
                          <Checkbox
                            checked={todasTildadas}
                            disabled={pagables.length === 0}
                            onCheckedChange={(v) => tildarTodas(v === true)}
                            aria-label="Tildar todas las pagables"
                          />
                        )}
                      </TableHead>
                      <TableHead>Nro.</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Vencimiento</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Pagado</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead className="text-right">Saldo acum.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filas.map((f) => {
                      const tildada = tildadas.has(f.idFactura)
                      const puede = f.pagable && f.saldo > 0
                      const vencida = !!aIso(f.vencimiento) && aIso(f.vencimiento) < hoy
                      return (
                        <TableRow
                          key={f.idFactura}
                          className={!puede ? 'text-muted-foreground' : tildada ? 'bg-blue-50/60' : ''}
                          title={!puede ? f.motivoNoPagable ?? 'No se puede pagar desde el ERP' : undefined}
                        >
                          <TableCell>
                            {!sinPermisoPagos && (
                              <Checkbox
                                checked={tildada}
                                disabled={!puede}
                                onCheckedChange={(v) => tildar(f.idFactura, v === true)}
                                aria-label={`Tildar ${f.nroFactura}`}
                                title={!puede ? f.motivoNoPagable ?? 'No se puede pagar desde el ERP' : undefined}
                              />
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-sm">{f.nroFactura}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{f.tipoComprobante || '—'}</TableCell>
                          <TableCell className={`whitespace-nowrap text-sm ${vencida && puede ? 'font-medium text-red-700' : ''}`}>{fechaCorta(f.vencimiento)}</TableCell>
                          <TableCell className="max-w-[16rem] text-sm">
                            <p className="truncate" title={f.descripcion || undefined}>
                              {f.descripcion || '—'}
                            </p>
                            {!f.pagable && f.motivoNoPagable && <p className="truncate text-xs text-amber-800">{f.motivoNoPagable}</p>}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right font-mono text-sm">{formatCurrency(f.totalFactura)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right font-mono text-sm">{formatCurrency(f.pagado)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right font-mono text-sm font-semibold">{formatCurrency(f.saldo)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right font-mono text-sm text-muted-foreground">{formatCurrency(f.acumulado)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                  {!sinPermisoPagos && (
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={7} className="text-sm">
                          {tildadas.size === 0 ? 'Tildá las facturas a pagar' : `${tildadas.size} tildada${tildadas.size === 1 ? '' : 's'}`}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono font-bold">{formatCurrency(totalTildado)}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Pagos */}
          <TabsContent value="pagos" className="m-0">
            <div className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
              <span className="text-muted-foreground">Órdenes de pago hechas desde el ERP</span>
              <Button variant="ghost" size="sm" onClick={cargarPagos} disabled={pagos.estado === 'cargando'}>
                <RefreshCw className={`mr-1 h-4 w-4 ${pagos.estado === 'cargando' ? 'animate-spin' : ''}`} />
                Refrescar
              </Button>
            </div>
            {pagos.estado === 'cargando' && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
              </div>
            )}
            {pagos.estado === 'error' && (
              <div className="mx-4 mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {pagos.status === 403 ? 'Sin permisos para ver los pagos a proveedores.' : pagos.mensaje}
              </div>
            )}
            {pagos.estado === 'ok' &&
              (pagos.data.ordenes.length === 0 ? (
                <p className="px-4 pb-6 text-sm text-muted-foreground">Todavía no hay pagos a este proveedor desde el ERP.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-blue-50">
                        <TableHead>Fecha</TableHead>
                        <TableHead>Número</TableHead>
                        <TableHead className="text-right">Facturas</TableHead>
                        <TableHead className="text-right">Total pagado</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Cargó</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagos.data.ordenes.map((o) => {
                        const est = ESTADOS_OP[o.estado] ?? { label: o.estado, className: 'bg-gray-100 text-gray-700' }
                        return (
                          <TableRow key={o.id}>
                            <TableCell className="whitespace-nowrap text-sm">{fechaCorta(o.fecha)}</TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-sm">{o.numero ?? '—'}</TableCell>
                            <TableCell className="text-right text-sm">{o.facturas}</TableCell>
                            <TableCell className="whitespace-nowrap text-right font-mono text-sm">{formatCurrency(o.totalPagado)}</TableCell>
                            <TableCell>
                              <Badge className={est.className} title={o.error ?? undefined}>
                                {est.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{o.creadaPor}</TableCell>
                            <TableCell className="text-right">
                              <Link href={`/proveedores/pagos/${o.id}`} className="text-sm text-blue-700 hover:underline">
                                Ver
                              </Link>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              ))}
          </TabsContent>

          {/* Información general */}
          <TabsContent value="info" className="m-0">
            <dl className="grid gap-x-8 gap-y-3 p-4 text-sm sm:grid-cols-2">
              <Dato label="Nombre" valor={proveedor.name} />
              <Dato label="Razón social" valor={proveedor.legalName || '—'} />
              <Dato label="CUIT" valor={proveedor.taxId || '—'} />
              <Dato label="Estado" valor={ESTADOS_PROVEEDOR[proveedor.status] ?? proveedor.status} />
              <Dato label="Comprador" valor={proveedor.buyerUser?.name || '—'} />
              <Dato label="Descuento" valor={`${Number(proveedor.discount) || 0}%`} />
              <Dato label="Saldo (último sync de Colppy)" valor={formatCurrency(proveedor.balance)} />
              <Dato label="Preferido" valor={proveedor.isPreferred ? 'Sí' : 'No'} />
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Marcas</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {proveedor.brands.length === 0
                    ? '—'
                    : proveedor.brands.map((b) => (
                        <span key={b} className="inline-flex items-center rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                          {b}
                        </span>
                      ))}
                </dd>
              </div>
            </dl>
            <div className="px-4 pb-4">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/proveedores/${proveedor.id}`}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Ver ficha completa
                </Link>
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {/* Botones (como Colppy) */}
        <div className="flex flex-wrap items-center gap-3 border-t bg-gray-50/60 px-4 py-3">
          <Button variant="outline" onClick={() => setFacturaAbierta(true)}>
            <FilePlus2 className="mr-2 h-4 w-4" />
            Agregar factura
          </Button>
          {!sinPermisoPagos && (
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setPagoAbierto(true)} disabled={sinColppy}>
              <Banknote className="mr-2 h-4 w-4" />
              Agregar pago
              {tildadas.size > 0 && ` (${tildadas.size} · ${formatCurrency(totalTildado)})`}
            </Button>
          )}
          {sinPermisoPagos && <span className="text-xs text-muted-foreground">No tenés permisos para pagar a proveedores.</span>}
        </div>
      </CardContent>

      {/* Agregar factura */}
      <Sheet open={facturaAbierta} onOpenChange={cerrarFactura}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-[min(1400px,96vw)]"
          // Solo se cierra con Cancelar o la X (un Esc o un clic afuera perdería lo cargado)
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <SheetHeader className="border-b">
            <SheetTitle>Nueva factura de compra</SheetTitle>
            <SheetDescription>{nombre}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4">
            {facturaAbierta && (
              <NuevaFacturaCompraForm
                embebido
                proveedorInicialId={proveedor.id}
                onGuardada={alGuardarFactura}
                onCerrar={() => cerrarFactura(false)}
                onOcupadoChange={setFacturaOcupada}
                onSucioChange={setFacturaSucia}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Agregar pago */}
      <Sheet open={pagoAbierto} onOpenChange={cerrarPago}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-[min(1100px,96vw)]"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <SheetHeader className="border-b">
            <SheetTitle>Nueva orden de pago</SheetTitle>
            <SheetDescription>{nombre} · se da de alta en Colppy</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4">
            {pagoAbierto && (
              <NuevaOrdenPagoForm
                embebido
                proveedorInicial={{ id: proveedor.id, nombre, cuit: proveedor.taxId, colppyId: proveedor.colppyId }}
                facturasIniciales={[...tildadas]}
                onRegistrada={alRegistrarPago}
                onCerrar={() => cerrarPago(false)}
                onOcupadoChange={setPagoOcupado}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </Card>
  )
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{valor}</dd>
    </div>
  )
}

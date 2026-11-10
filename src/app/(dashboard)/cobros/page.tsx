'use client'

/**
 * Cobros, como la gestión de clientes de Colppy: a la izquierda la lista de
 * clientes (por saldo de mayor a menor) y a la derecha el cliente elegido con
 * sus facturas adeudadas, los recibos cargados desde el ERP y el botón
 * "Agregar cobro" (abre el formulario en un panel lateral).
 *
 * El cliente elegido queda en la URL (?cliente=<id>). Sin cliente elegido se
 * muestran los últimos recibos cargados desde el ERP.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, HandCoins, Loader2, MousePointerClick, Plus, RefreshCw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import NuevoCobroForm from '@/components/cobros/NuevoCobroForm'
import type { PreparacionCobro } from '@/lib/cobros-colppy/registrar'

interface ClienteLista {
  id: string
  name: string
  businessName: string | null
  cuit: string
  balance: number | string
}

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

const POR_PAGINA = 50

/** YYYY-MM-DD → DD/MM/YYYY sin pasar por Date (evita el corrimiento de huso) */
function fechaIso(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s
}
/** DD-MM-YYYY (Colppy) → DD/MM/YYYY */
function fechaColppy(s: string) {
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})/.exec(s)
  return m ? `${m[1]}/${m[2]}/${m[3]}` : s || '—'
}

/** Recibos cargados desde el ERP (de un cliente o de todos) */
function RecibosErp({ clienteId, version, conCliente }: { clienteId?: string; version: number; conCliente?: boolean }) {
  const [cobros, setCobros] = useState<CobroListado[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [verificando, setVerificando] = useState<string | null>(null)

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
    void cargar()
  }, [cargar, version])

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

/** Panel del cliente elegido: facturas adeudadas (en vivo de Colppy), recibos del ERP y "Agregar cobro" */
function ClientePanel({ clienteId, nombreLista, onCerrar, onCobrado }: { clienteId: string; nombreLista?: string; onCerrar: () => void; onCobrado: () => void }) {
  const [prep, setPrep] = useState<PreparacionCobro | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tildadas, setTildadas] = useState<Set<string>>(new Set())
  const [abierto, setAbierto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [version, setVersion] = useState(0)

  const traer = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const r = await fetch(`/api/cobros/preparar?customerId=${encodeURIComponent(clienteId)}`)
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setPrep(null)
        setError(d?.error || `No se pudo leer Colppy (HTTP ${r.status})`)
        return
      }
      setPrep(d as PreparacionCobro)
    } catch {
      setPrep(null)
      setError('No se pudo conectar con el servidor')
    } finally {
      setCargando(false)
    }
  }, [clienteId])

  useEffect(() => {
    setPrep(null)
    setTildadas(new Set())
    void traer()
  }, [traer])

  const nombre = prep?.cliente.nombre ?? nombreLista ?? 'Cliente'
  const adeudado = useMemo(() => (prep ? prep.impagas.reduce((a, f) => a + f.saldo, 0) : 0), [prep])
  const cobrables = prep?.impagas.filter((f) => f.cobrable) ?? []
  const totalTildado = cobrables.filter((f) => tildadas.has(f.idFactura)).reduce((a, f) => a + f.saldo, 0)

  return (
    <Card className="border-blue-200">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-blue-900">{nombre}</h2>
            <p className="text-sm text-muted-foreground">
              {prep ? `CUIT ${prep.cliente.cuit} · ` : ''}Adeudado en Colppy: <span className="font-semibold text-foreground">{prep ? formatCurrency(adeudado) : '…'}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" aria-label="Actualizar" onClick={() => traer()} disabled={cargando}>
              <RefreshCw className={`h-4 w-4 ${cargando ? 'animate-spin' : ''}`} />
            </Button>
            <Button className="bg-blue-600 hover:bg-blue-700" disabled={!prep || cobrables.length === 0} onClick={() => setAbierto(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Agregar cobro
            </Button>
            <Button variant="ghost" size="icon" aria-label="Cerrar cliente" onClick={onCerrar}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Tabs defaultValue="adeudadas">
          <TabsList className="bg-blue-50">
            <TabsTrigger value="adeudadas" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
              Facturas adeudadas
            </TabsTrigger>
            <TabsTrigger value="recibos" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
              Cobros del ERP
            </TabsTrigger>
          </TabsList>

          <TabsContent value="adeudadas">
            {cargando && !prep ? (
              <div className="flex items-center justify-center p-10 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Leyendo Colppy…
              </div>
            ) : error ? (
              <div className="space-y-3 p-8 text-center text-sm text-red-700">
                <p>{error}</p>
                <Button variant="outline" size="sm" onClick={() => traer()}>
                  Reintentar
                </Button>
              </div>
            ) : !prep || prep.impagas.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">Este cliente no tiene comprobantes impagos en Colppy.</div>
            ) : (
              <>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-blue-50">
                        <TableHead className="w-10" />
                        <TableHead>Comprobante</TableHead>
                        <TableHead>Vencimiento</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Saldo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {prep.impagas.map((f) => (
                        <TableRow key={f.idFactura} className={f.cobrable ? '' : 'text-muted-foreground'}>
                          <TableCell>
                            <Checkbox
                              aria-label={`Cobrar ${f.nroFactura}`}
                              disabled={!f.cobrable}
                              checked={tildadas.has(f.idFactura)}
                              onCheckedChange={(v) =>
                                setTildadas((s) => {
                                  const n = new Set(s)
                                  if (v) n.add(f.idFactura)
                                  else n.delete(f.idFactura)
                                  return n
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">
                              {f.tipoComprobante} {f.nroFactura}
                            </div>
                            {(f.motivoNoCobrable || f.descripcion) && (
                              <div className="max-w-md truncate text-xs text-muted-foreground" title={f.motivoNoCobrable ?? f.descripcion}>
                                {f.motivoNoCobrable ?? f.descripcion}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>{fechaColppy(f.vencimiento)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(f.totalFactura)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(f.saldo)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {tildadas.size > 0
                    ? `${tildadas.size} tildada${tildadas.size === 1 ? '' : 's'}: ${formatCurrency(totalTildado)}. "Agregar cobro" las trae ya marcadas.`
                    : 'Tildá las que te pagaron y tocá "Agregar cobro", o abrilo y marcalas ahí.'}
                </p>
              </>
            )}
          </TabsContent>

          <TabsContent value="recibos">
            <RecibosErp clienteId={clienteId} version={version} />
          </TabsContent>
        </Tabs>
      </CardContent>

      <Sheet open={abierto} onOpenChange={(v) => !ocupado && setAbierto(v)}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-[min(1200px,96vw)]"
          // Solo se cierra con Cancelar o la X (un Esc o un clic afuera perdería lo cargado)
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <SheetHeader className="border-b">
            <SheetTitle>Nuevo cobro</SheetTitle>
            <SheetDescription>{nombre} · el recibo se da de alta en Colppy</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4">
            {abierto && (
              <NuevoCobroForm
                clienteId={clienteId}
                facturasIniciales={[...tildadas]}
                onOcupadoChange={setOcupado}
                onCerrar={() => setAbierto(false)}
                onRegistrado={() => {
                  setAbierto(false)
                  setTildadas(new Set())
                  setVersion((v) => v + 1)
                  void traer()
                  onCobrado()
                }}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </Card>
  )
}

function CobrosGestion() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const seleccionadoId = searchParams.get('cliente') || ''

  const [clientes, setClientes] = useState<ClienteLista[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [filtro, setFiltro] = useState<'deudores' | 'todos'>('deudores')
  const [busqueda, setBusqueda] = useState('')
  const busquedaLenta = useDebouncedValue(busqueda, 400)
  const [cargando, setCargando] = useState(true)
  const [version, setVersion] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)

  /** Lo que se está listando; cambiar filtro o búsqueda vuelve a la página 1 */
  const consulta = `${filtro}|${busquedaLenta.trim()}`
  const consultaPrevia = useRef(consulta)

  const cargar = useCallback(async (pag: number, fil: string, texto: string) => {
    setCargando(true)
    try {
      const params = new URLSearchParams({ page: String(pag), limit: String(POR_PAGINA), sortBy: 'balance', sortOrder: 'desc' })
      if (fil === 'deudores') params.set('balanceFilter', 'deudores')
      if (texto) params.set('search', texto)
      const r = await fetch(`/api/clientes?${params}`)
      const d = r.ok ? await r.json().catch(() => null) : null
      return d as { customers?: ClienteLista[]; pagination?: { total?: number } } | null
    } catch {
      return null
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    let vigente = true
    const cambio = consultaPrevia.current !== consulta
    consultaPrevia.current = consulta
    const pag = cambio ? 1 : pagina
    void cargar(pag, filtro, busquedaLenta.trim()).then((d) => {
      if (!vigente) return
      if (!d) {
        toast.error('No se pudo leer la lista de clientes')
        return
      }
      if (cambio) setPagina(1)
      setClientes(Array.isArray(d.customers) ? d.customers : [])
      setTotal(Number(d.pagination?.total) || 0)
    })
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina, consulta, version, cargar])

  const seleccionar = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (id) params.set('cliente', id)
      else params.delete('cliente')
      router.replace(params.size ? `${pathname}?${params.toString()}` : pathname, { scroll: false })
      // En mobile el panel queda abajo de la lista: llevarlo a la vista
      if (id && typeof window !== 'undefined' && window.innerWidth < 1024) {
        setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
      }
    },
    [pathname, router, searchParams]
  )

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const elegido = clientes.find((c) => c.id === seleccionadoId)

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-blue-900">
          <HandCoins className="h-7 w-7" />
          Cobros
        </h1>
        <p className="text-muted-foreground">Elegí un cliente para ver lo que debe y cargarle el cobro. El recibo se registra en Colppy.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Lista de clientes */}
        <Card className="self-start border-blue-200">
          <CardContent className="p-4">
            <h2 className="mb-3 text-lg font-semibold text-blue-900">Lista de clientes</h2>
            <Tabs value={filtro} onValueChange={(v) => setFiltro(v as 'deudores' | 'todos')} className="mb-3">
              <TabsList className="bg-blue-50">
                <TabsTrigger value="deudores" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                  Con saldo
                </TabsTrigger>
                <TabsTrigger value="todos" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                  Todos
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input placeholder="Buscar por nombre, razón social o CUIT..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="pl-10" />
            </div>

            {cargando && clientes.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
              </div>
            ) : clientes.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">No se encontraron clientes</div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-blue-50">
                      <TableHead>Cliente</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clientes.map((c) => (
                      <TableRow
                        key={c.id}
                        onClick={() => seleccionar(c.id)}
                        className={`cursor-pointer ${c.id === seleccionadoId ? 'bg-blue-100 hover:bg-blue-100' : 'hover:bg-blue-50'}`}
                      >
                        <TableCell>
                          <div className="font-medium">{c.businessName || c.name}</div>
                          <div className="text-xs text-muted-foreground">{c.cuit}</div>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(Number(c.balance))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {total} cliente{total === 1 ? '' : 's'} · saldos del último sync con Colppy
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Página anterior" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2">
                  {pagina} / {paginas}
                </span>
                <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Página siguiente" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Cliente elegido, o los últimos recibos */}
        <div ref={panelRef} className="min-w-0">
          {seleccionadoId ? (
            <ClientePanel
              key={seleccionadoId}
              clienteId={seleccionadoId}
              nombreLista={elegido ? elegido.businessName || elegido.name : undefined}
              onCerrar={() => seleccionar(null)}
              onCobrado={() => setVersion((v) => v + 1)}
            />
          ) : (
            <Card className="border-blue-200">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-2 rounded-md bg-blue-50 p-3 text-sm text-blue-900">
                  <MousePointerClick className="h-4 w-4 shrink-0" />
                  Elegí un cliente de la lista para ver sus facturas adeudadas y agregarle un cobro.
                </div>
                <h2 className="text-lg font-semibold text-blue-900">Últimos cobros cargados desde el ERP</h2>
                <RecibosErp version={version} conCliente />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

export default function CobrosPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Cargando…
        </div>
      }
    >
      <CobrosGestion />
    </Suspense>
  )
}

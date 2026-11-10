'use client'

/**
 * Cobros: quién debe (clientes por saldo) y los últimos recibos cargados desde
 * el ERP. El cobro en sí se carga en la ficha del cliente, pestaña "Facturas
 * Adeudadas" (botón "Agregar cobro"): tocar un cliente de la lista lleva ahí.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, HandCoins, Loader2, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import RecibosErp from '@/components/cobros/RecibosErp'

interface ClienteLista {
  id: string
  name: string
  businessName: string | null
  cuit: string
  balance: number | string
}

const POR_PAGINA = 50

/** Ficha del cliente, abierta en la pestaña donde se carga el cobro */
const fichaCobro = (id: string) => `/clientes/${encodeURIComponent(id)}?tab=facturas`

function CobrosGestion() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Enlaces viejos (/cobros?cliente=<id>): van a la ficha del cliente
  const clienteViejo = searchParams.get('cliente')
  useEffect(() => {
    if (clienteViejo) router.replace(fichaCobro(clienteViejo))
  }, [clienteViejo, router])

  const [clientes, setClientes] = useState<ClienteLista[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [filtro, setFiltro] = useState<'deudores' | 'todos'>('deudores')
  const [busqueda, setBusqueda] = useState('')
  const busquedaLenta = useDebouncedValue(busqueda, 400)
  const [cargando, setCargando] = useState(true)

  /** Orden de la lista: por saldo (de más deuda a menos, por defecto) o por nombre */
  const [orden, setOrden] = useState<{ por: 'balance' | 'name'; dir: 'asc' | 'desc' }>({ por: 'balance', dir: 'desc' })
  const ordenar = (por: 'balance' | 'name') =>
    setOrden((o) => (o.por === por ? { por, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { por, dir: por === 'balance' ? 'desc' : 'asc' }))
  const flecha = (por: 'balance' | 'name') =>
    orden.por !== por ? (
      <ArrowUpDown className="ml-1 inline h-3.5 w-3.5 text-gray-400" />
    ) : orden.dir === 'asc' ? (
      <ArrowUp className="ml-1 inline h-3.5 w-3.5 text-blue-600" />
    ) : (
      <ArrowDown className="ml-1 inline h-3.5 w-3.5 text-blue-600" />
    )

  /** Lo que se está listando; cambiar filtro, búsqueda u orden vuelve a la página 1 */
  const consulta = `${filtro}|${busquedaLenta.trim()}|${orden.por}|${orden.dir}`
  const consultaPrevia = useRef(consulta)

  const cargar = useCallback(async (pag: number, fil: string, texto: string, por: string, dir: string) => {
    setCargando(true)
    try {
      const params = new URLSearchParams({ page: String(pag), limit: String(POR_PAGINA), sortBy: por, sortOrder: dir })
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
    void cargar(pag, filtro, busquedaLenta.trim(), orden.por, orden.dir).then((d) => {
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
  }, [pagina, consulta, cargar])

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-blue-900">
          <HandCoins className="h-7 w-7" />
          Cobros
        </h1>
        <p className="text-muted-foreground">Tocá un cliente para abrir su ficha en &quot;Facturas Adeudadas&quot; y cargarle el cobro. El recibo se registra en Colppy.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Quién debe */}
        <Card className="self-start border-blue-200">
          <CardContent className="p-4">
            <h2 className="mb-3 text-lg font-semibold text-blue-900">Clientes</h2>
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
                      <TableHead>
                        <button type="button" className="flex items-center font-medium hover:text-blue-700" onClick={() => ordenar('name')} title="Ordenar por nombre">
                          Cliente{flecha('name')}
                        </button>
                      </TableHead>
                      <TableHead className="text-right">
                        <button
                          type="button"
                          className="ml-auto flex items-center font-medium hover:text-blue-700"
                          onClick={() => ordenar('balance')}
                          title={orden.por === 'balance' && orden.dir === 'desc' ? 'De más deuda a menos (tocá para invertir)' : 'Ordenar de más deuda a menos'}
                        >
                          Saldo{flecha('balance')}
                        </button>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clientes.map((c) => (
                      <TableRow key={c.id} onClick={() => router.push(fichaCobro(c.id))} className="cursor-pointer hover:bg-blue-50" title="Abrir la ficha del cliente para cargar el cobro">
                        <TableCell className="w-full max-w-0">
                          <div className="truncate font-medium" title={c.businessName || c.name}>
                            {c.businessName || c.name}
                          </div>
                          <div className="text-xs text-muted-foreground">{c.cuit}</div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">{formatCurrency(Number(c.balance))}</TableCell>
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

        {/* Últimos recibos */}
        <Card className="min-w-0 self-start border-blue-200">
          <CardContent className="space-y-3 p-4">
            <h2 className="text-lg font-semibold text-blue-900">Últimos cobros cargados desde el ERP</h2>
            <RecibosErp version={0} conCliente />
          </CardContent>
        </Card>
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

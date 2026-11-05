'use client'

/**
 * Proveedores → Gestión de proveedores, como en Colppy: a la izquierda la
 * lista (por saldo de mayor a menor) y a la derecha el proveedor elegido con
 * sus facturas adeudadas, pagos e información, y los botones "Agregar factura"
 * y "Agregar pago" (abren los formularios en un panel lateral).
 *
 * El proveedor elegido queda en la URL (?proveedor=<id>) para que al recargar
 * siga seleccionado.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Search,
  UserPlus,
  Upload,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Star,
  Loader2,
  CloudDownload,
  MousePointerClick,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'
import ProveedorPanel, { type ProveedorDelListado } from '@/components/proveedores/ProveedorPanel'

type Supplier = ProveedorDelListado

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

function ProveedoresGestion() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const seleccionadoId = searchParams.get('proveedor') || ''

  const [loading, setLoading] = useState(true)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  })

  // Filters (por defecto, como Colppy: por saldo de mayor a menor)
  const [statusFilter, setStatusFilter] = useState<string>('ACTIVE')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('balance')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [syncing, setSyncing] = useState(false)

  // Proveedor elegido (puede no estar en la página actual de la lista)
  const [seleccionado, setSeleccionado] = useState<Supplier | null>(null)
  /** Saldos leídos en vivo de Colppy por el panel (pisan al del sync diario) */
  const [saldosVivos, setSaldosVivos] = useState<Record<string, number>>({})
  const anotarSaldoVivo = useCallback((id: string, saldo: number) => setSaldosVivos((m) => (m[id] === saldo ? m : { ...m, [id]: saldo })), [])
  const panelRef = useRef<HTMLDivElement>(null)

  const handleSyncColppy = async () => {
    try {
      setSyncing(true)
      toast.info('Sincronizando proveedores desde Colppy...')

      // El sync corre en background en el server: el POST responde al instante
      // y acá se hace polling del estado hasta que termine.
      const response = await fetch('/api/proveedores/sync-colppy', {
        method: 'POST',
      })

      const started = await response.json()

      if (!response.ok) {
        throw new Error(started.error || 'Error al sincronizar')
      }
      if (started.status === 'already_running') {
        toast.info('Ya hay una sincronización en progreso, esperando que termine...')
      }

      // Polling cada 2.5s, tope 10 minutos
      const maxAttempts = 240
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2500))
        const statusRes = await fetch('/api/proveedores/sync-colppy')
        if (!statusRes.ok) continue
        const status = await statusRes.json()

        if (status.status === 'done') {
          const data = status.result
          toast.success(
            `Sync completada: ${data.creados} creados, ${data.actualizados} actualizados` +
            (data.omitidos > 0 ? `, ${data.omitidos} omitidos` : '') +
            ` (${(data.tiempoMs / 1000).toFixed(1)}s)`
          )
          fetchSuppliers()
          return
        }
        if (status.status === 'error') {
          throw new Error(status.error || 'Error al sincronizar')
        }
        // 'running' → seguir esperando
      }
      throw new Error('La sincronización sigue corriendo en el servidor; recargá en unos minutos')
    } catch (error) {
      console.error('Error sync Colppy:', error)
      toast.error((error instanceof Error && error.message) || 'Error al sincronizar proveedores')
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    fetchSuppliers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, pagination.page, sortBy, sortOrder])

  // Debounce search
  const primeraBusqueda = useRef(true)
  useEffect(() => {
    // La primera carga ya la hace el efecto de arriba
    if (primeraBusqueda.current) {
      primeraBusqueda.current = false
      return
    }
    const timer = setTimeout(() => {
      if (pagination.page === 1) {
        fetchSuppliers()
      } else {
        setPagination({ ...pagination, page: 1 })
      }
    }, 500)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  const fetchSuppliers = async () => {
    try {
      setLoading(true)

      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        status: statusFilter,
        sortBy,
        sortOrder,
      })

      if (searchQuery) {
        params.append('search', searchQuery)
      }

      const response = await fetch(`/api/proveedores?${params}`)

      if (!response.ok) {
        if (response.status === 401) {
          toast.error('Sesión expirada. Por favor inicia sesión nuevamente.')
          window.location.href = '/login'
          return
        }

        let errorMessage = `Error ${response.status}: ${response.statusText}`
        try {
          const errorData = await response.json()
          errorMessage = errorData.error || errorData.message || errorMessage
        } catch (e) {
          console.error('Could not parse error response:', e)
        }

        throw new Error(errorMessage)
      }

      const data = await response.json()
      const lista: Supplier[] = data.suppliers || []
      setSuppliers(lista)
      setPagination(data.pagination || pagination)
      // El elegido se actualiza con lo último de la lista (saldo del sync, etc.)
      setSeleccionado((s) => (s ? (lista.find((x) => x.id === s.id) ?? s) : s))
    } catch (error) {
      console.error('Error fetching suppliers:', error)
      toast.error(error instanceof Error ? error.message : 'Error al cargar proveedores')
    } finally {
      setLoading(false)
    }
  }

  // Proveedor de la URL: de la lista si está, si no se lee aparte
  useEffect(() => {
    if (!seleccionadoId) {
      setSeleccionado(null)
      return
    }
    if (seleccionado?.id === seleccionadoId) return
    const enLista = suppliers.find((s) => s.id === seleccionadoId)
    if (enLista) {
      setSeleccionado(enLista)
      return
    }
    let vigente = true
    fetch(`/api/proveedores/${encodeURIComponent(seleccionadoId)}`)
      .then(async (r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => {
        if (!vigente) return
        if (d && typeof d.id === 'string') {
          setSeleccionado(d as Supplier)
          return
        }
        // Id inválido en la URL: se saca, así no queda cargando para siempre
        setSeleccionado(null)
        const params = new URLSearchParams(searchParams.toString())
        params.delete('proveedor')
        router.replace(params.size ? `${pathname}?${params.toString()}` : pathname, { scroll: false })
        toast.error('No se encontró el proveedor elegido')
      })
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionadoId, suppliers])

  const seleccionar = useCallback(
    (s: Supplier) => {
      setSeleccionado(s)
      const params = new URLSearchParams(searchParams.toString())
      params.set('proveedor', s.id)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
      // En mobile el panel queda abajo de la lista: llevarlo a la vista
      if (typeof window !== 'undefined' && window.innerWidth < 1024) {
        setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
      }
    },
    [pathname, router, searchParams]
  )

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      // El saldo arranca de mayor a menor; los textos, de la A a la Z
      setSortOrder(column === 'balance' ? 'desc' : 'asc')
    }
  }

  const getSortIcon = (column: string) => {
    if (sortBy !== column) {
      return <ArrowUpDown className="h-4 w-4 ml-1 text-gray-400" />
    }
    return sortOrder === 'asc' ? (
      <ArrowUp className="h-4 w-4 ml-1 text-blue-600" />
    ) : (
      <ArrowDown className="h-4 w-4 ml-1 text-blue-600" />
    )
  }

  const goToPage = (page: number) => {
    setPagination({ ...pagination, page })
  }

  const startIndex = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1
  const endIndex = Math.min(pagination.page * pagination.limit, pagination.total)

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-blue-900">
            Gestión de proveedores
          </h1>
          <p className="text-muted-foreground">
            Elegí un proveedor para ver lo que le debemos, cargarle facturas y pagarle
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={handleSyncColppy}
            disabled={syncing}
            className="border-purple-600 text-purple-600 hover:bg-purple-50"
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CloudDownload className="h-4 w-4 mr-2" />
            )}
            {syncing ? 'Sincronizando...' : 'Sync Colppy → DB'}
          </Button>
          <Button variant="outline" onClick={fetchSuppliers}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Actualizar
          </Button>
          <Button
            className="bg-blue-600 hover:bg-blue-700"
            onClick={() => router.push('/proveedores/nuevo')}
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Nuevo proveedor
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push('/proveedores/importar')}
          >
            <Upload className="h-4 w-4 mr-2" />
            Importar
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Lista de proveedores */}
        <Card className="border-blue-200 self-start">
          <CardContent className="p-4">
            <h2 className="text-lg font-semibold text-blue-900 mb-3">
              Lista de proveedores
            </h2>

            <Tabs
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v)
                if (pagination.page !== 1) setPagination({ ...pagination, page: 1 })
              }}
              className="mb-3"
            >
              <TabsList className="bg-blue-50">
                <TabsTrigger
                  value="ACTIVE"
                  className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                >
                  Activos
                </TabsTrigger>
                <TabsTrigger
                  value="INACTIVE"
                  className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                >
                  Inactivos
                </TabsTrigger>
                <TabsTrigger
                  value="BLOCKED"
                  className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                >
                  Bloqueados
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Search */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Buscar por nombre, razón social o CUIT..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Table */}
            {loading && suppliers.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
              </div>
            ) : suppliers.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>No se encontraron proveedores</p>
              </div>
            ) : (
              <>
                <div className={`border rounded-lg overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-blue-50">
                        <TableHead
                          className="cursor-pointer hover:bg-blue-100 transition-colors"
                          onClick={() => handleSort('name')}
                        >
                          <div className="flex items-center font-semibold text-blue-900">
                            Proveedor
                            {getSortIcon('name')}
                          </div>
                        </TableHead>
                        <TableHead
                          className="text-right cursor-pointer hover:bg-blue-100 transition-colors"
                          onClick={() => handleSort('balance')}
                        >
                          <div className="flex items-center justify-end font-semibold text-blue-900">
                            Saldo
                            {getSortIcon('balance')}
                          </div>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {suppliers.map((supplier) => {
                        const activo = supplier.id === seleccionadoId
                        return (
                          <TableRow
                            key={supplier.id}
                            className={`cursor-pointer transition-colors ${activo ? 'bg-blue-100 hover:bg-blue-100' : 'hover:bg-blue-50'}`}
                            onClick={() => seleccionar(supplier)}
                            aria-selected={activo}
                          >
                            <TableCell className={`max-w-0 w-full text-sm ${activo ? 'font-semibold text-blue-900' : 'font-medium'}`}>
                              <div className="flex items-center gap-1">
                                {supplier.isPreferred && (
                                  <Star className="h-3.5 w-3.5 shrink-0 text-yellow-500 fill-yellow-500" />
                                )}
                                <span className="truncate" title={supplier.name}>{supplier.name}</span>
                              </div>
                              {/* Razón social solo si es distinta del nombre (en Colppy pasa con los monotributistas) */}
                              {supplier.legalName && supplier.legalName.trim() !== supplier.name.trim() && (
                                <span className="block truncate text-xs font-normal text-muted-foreground" title={supplier.legalName}>
                                  {supplier.legalName}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right font-mono text-sm">
                              {formatCurrency(saldosVivos[supplier.id] ?? supplier.balance)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => goToPage(1)}
                      disabled={pagination.page === 1}
                      aria-label="Primera página"
                    >
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => goToPage(pagination.page - 1)}
                      disabled={pagination.page === 1}
                      aria-label="Página anterior"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>

                    <span className="text-sm text-muted-foreground px-2">
                      <span className="font-semibold">{pagination.page}</span> de{' '}
                      <span className="font-semibold">{Math.max(1, pagination.totalPages)}</span>
                    </span>

                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => goToPage(pagination.page + 1)}
                      disabled={pagination.page >= pagination.totalPages}
                      aria-label="Página siguiente"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => goToPage(pagination.totalPages)}
                      disabled={pagination.page >= pagination.totalPages}
                      aria-label="Última página"
                    >
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>

                  <span className="text-xs text-muted-foreground">
                    {startIndex} - {endIndex} de <span className="font-semibold">{pagination.total}</span>
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Proveedor elegido */}
        <div ref={panelRef} className="min-w-0 scroll-mt-4">
          {seleccionado ? (
            <ProveedorPanel key={seleccionado.id} proveedor={seleccionado} onCambioSaldo={fetchSuppliers} onSaldoColppy={anotarSaldoVivo} />
          ) : seleccionadoId ? (
            <Card className="border-blue-200">
              <CardContent className="flex items-center justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed border-blue-200">
              <CardContent className="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
                <MousePointerClick className="h-8 w-8 text-blue-300" />
                <p className="font-medium">Elegí un proveedor de la lista</p>
                <p className="text-sm">Vas a ver sus facturas adeudadas y podés cargarle facturas o pagarle.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ProveedoresPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      }
    >
      <ProveedoresGestion />
    </Suspense>
  )
}

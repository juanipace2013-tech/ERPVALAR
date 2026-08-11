'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Users,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader2,
  Upload,
  Database,
  Clock,
  Download,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber, formatCUIT, formatDateAR } from '@/lib/utils'
import ImportarAsignacionesModal from '@/components/clientes/ImportarAsignacionesModal'
import { CONDICIONES_IVA } from '@/lib/constants'

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Customer {
  id: string
  name: string
  businessName: string | null
  cuit: string
  taxCondition: string
  email: string | null
  phone: string | null
  mobile: string | null
  address: string | null
  city: string | null
  province: string | null
  status: string
  type: string
  balance: number
  creditLimit: number | null
  creditCurrency: string | null
  priceMultiplier: number
  createdAt: string
  salesPerson: { id: string; name: string; email: string } | null
}

interface ActivityData {
  lastActivity: string | null
  activeQuotes: number
  localId: string | null
  salesPerson: { id: string; name: string; email: string } | null
}

type SortField = 'businessName' | 'cuit' | 'taxCondition' | 'balance'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 50

const TAX_LABEL: Record<string, string> = Object.fromEntries(
  CONDICIONES_IVA.map((c) => [c.value, c.label])
)

// ─── Página ──────────────────────────────────────────────────────────────────

export default function ClientesPage() {
  const router = useRouter()

  // Data
  const [customers, setCustomers] = useState<Customer[]>([])
  const [total, setTotal] = useState(0)
  const [activityMap, setActivityMap] = useState<Record<string, ActivityData>>({})
  const [loading, setLoading] = useState(true)
  const [loadingActivity, setLoadingActivity] = useState(false)

  // Users for vendedor filter
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])
  const [showImportModal, setShowImportModal] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastBalanceSync, setLastBalanceSync] = useState<string | null>(null)

  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const fetchAbortRef = useRef<AbortController | null>(null)
  const [filtroIva, setFiltroIva] = useState('todas')
  const [filtroSaldo, setFiltroSaldo] = useState('todos')
  const [filtroCotizaciones, setFiltroCotizaciones] = useState(false)
  const [filtroVendedor, setFiltroVendedor] = useState('todos')

  // Sort
  const [sortField, setSortField] = useState<SortField>('businessName')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Pagination
  const [page, setPage] = useState(1)

  // Debounce search
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    searchTimer.current = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(searchTimer.current)
  }, [searchQuery])

  // Reset page on filter change
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, filtroIva, filtroSaldo, filtroVendedor])

  // ─── Fetch customers from local DB ────────────────────────────────────────

  const fetchCustomers = useCallback(async () => {
    // Cancelar la búsqueda anterior si sigue en vuelo (evita respuestas fuera de orden)
    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller

    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        sortBy: sortField,
        sortOrder: sortDir,
      })

      if (debouncedSearch) params.set('search', debouncedSearch)
      if (filtroIva !== 'todas') params.set('taxCondition', filtroIva)
      if (filtroSaldo !== 'todos') params.set('balanceFilter', filtroSaldo)
      if (filtroVendedor !== 'todos') params.set('salesPersonId', filtroVendedor)

      const res = await fetch(`/api/clientes?${params}`, { signal: controller.signal })
      if (!res.ok) throw new Error('Error al cargar clientes')
      const data = await res.json()
      setCustomers(data.customers || [])
      setTotal(data.pagination?.total || 0)
      setLoading(false)
    } catch (e: any) {
      if (controller.signal.aborted) return
      toast.error(e.message || 'Error al cargar clientes')
      setLoading(false)
    }
  }, [page, PAGE_SIZE, sortField, sortDir, debouncedSearch, filtroIva, filtroSaldo, filtroVendedor])

  useEffect(() => {
    fetchCustomers()
  }, [fetchCustomers])

  // ─── Fetch activity data for current page ─────────────────────────────────

  const fetchActivity = useCallback(async (custs: Customer[]) => {
    if (custs.length === 0) return
    setLoadingActivity(true)
    try {
      const cuits = custs
        .map((c) => c.cuit?.replace(/\D/g, ''))
        .filter((c) => c && c.length === 11)

      if (cuits.length === 0) return

      const res = await fetch('/api/clientes/batch-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cuits }),
      })
      if (!res.ok) return
      const data = await res.json()
      setActivityMap(data.activity || {})
    } catch {
      // No es crítico
    } finally {
      setLoadingActivity(false)
    }
  }, [])

  useEffect(() => {
    if (customers.length > 0) {
      fetchActivity(customers)
    }
  }, [customers, fetchActivity])

  // ─── Load users on mount ──────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/users?vendedores=true')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.users) setUsers(data.users)
      })
      .catch(() => {})
  }, [])

  // ─── Fetch last balance sync time ──────────────────────────────────────────

  const fetchLastSync = useCallback(() => {
    fetch('/api/cron/sync-balances')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.lastSync?.completedAt) {
          setLastBalanceSync(data.lastSync.completedAt)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchLastSync()
  }, [fetchLastSync])

  // ─── Client-side filter: cotizaciones activas (needs activity data) ───────

  const displayCustomers = useMemo(() => {
    if (!filtroCotizaciones) return customers
    return customers.filter((c) => {
      const cleanCuit = c.cuit?.replace(/\D/g, '')
      const activity = activityMap[cleanCuit]
      return activity && activity.activeQuotes > 0
    })
  }, [customers, filtroCotizaciones, activityMap])

  // ─── Sync Colppy (background con polling) ──────────────────────────────────

  const handleSyncColppy = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/clientes/sync-colppy', { method: 'POST' })
      if (!res.ok) throw new Error('Error al iniciar sincronización')
      const data = await res.json()

      if (data.status === 'already_running') {
        toast.info('Ya hay una sincronización en progreso')
        return
      }

      toast.info('Sincronización iniciada en background...')

      // Polling cada 5 segundos
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch('/api/clientes/sync-colppy')
          if (!statusRes.ok) return
          const statusData = await statusRes.json()

          if (statusData.status === 'completed') {
            clearInterval(pollInterval)
            setSyncing(false)
            toast.success(
              `Sincronización completada: ${statusData.creados} creados, ${statusData.actualizados} actualizados de ${statusData.total} clientes`
            )
            fetchCustomers()
            setLastBalanceSync(new Date().toISOString())
          } else if (statusData.status === 'error') {
            clearInterval(pollInterval)
            setSyncing(false)
            toast.error(`Error en sincronización: ${statusData.error}`)
          }
          // Si status === 'running', seguir esperando
        } catch {
          // Ignorar errores de polling
        }
      }, 5000)

      // Safety timeout: parar polling después de 5 minutos
      setTimeout(() => {
        clearInterval(pollInterval)
        setSyncing(false)
      }, 300000)
    } catch {
      toast.error('Error al iniciar sincronización')
      setSyncing(false)
    }
  }

  // ─── Sort handler ─────────────────────────────────────────────────────────

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir(field === 'balance' ? 'desc' : 'asc')
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 text-gray-400 inline" />
    return sortDir === 'asc'
      ? <ArrowUp className="h-3 w-3 ml-1 text-blue-600 inline" />
      : <ArrowDown className="h-3 w-3 ml-1 text-blue-600 inline" />
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const formatTimeAgo = (isoDate: string) => {
    const diff = Date.now() - new Date(isoDate).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'hace instantes'
    if (mins < 60) return `hace ${mins} min`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `hace ${hours}h`
    const days = Math.floor(hours / 24)
    return `hace ${days}d`
  }

  const saldoIndicator = (balance: number) => {
    if (balance <= 0) return 'text-green-600'
    if (balance > 100000) return 'text-red-600'
    return 'text-yellow-600'
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-blue-900">Clientes</h1>
            <p className="text-gray-500 text-sm">
              {total > 0 ? `${total} clientes en base de datos` : 'Cargando...'}
              {lastBalanceSync && (
                <span className="ml-3 inline-flex items-center gap-1 text-xs text-gray-400">
                  <Clock className="h-3 w-3" />
                  Saldos sincronizados {formatTimeAgo(lastBalanceSync)}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSyncColppy} disabled={syncing}>
            {syncing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Database className="h-4 w-4 mr-2" />
            )}
            {syncing ? 'Sincronizando...' : 'Sync Colppy → DB'}
          </Button>
          <Button variant="outline" onClick={() => setShowImportModal(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Importar Asignaciones
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = '/api/clientes/export-google-ads'
            }}
          >
            <Download className="h-4 w-4 mr-2" />
            Exportar Google Ads
          </Button>
          <Button variant="outline" onClick={fetchCustomers} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refrescar
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card className="border-blue-200">
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap items-end gap-3">
            {/* Búsqueda */}
            <div className="flex-1 min-w-[250px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Buscar por nombre, razón social o CUIT..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Condición IVA */}
            <div className="min-w-[170px]">
              <label className="text-xs text-gray-500 mb-1 block">Condición IVA</label>
              <Select value={filtroIva} onValueChange={setFiltroIva}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {CONDICIONES_IVA.map((iva) => (
                    <SelectItem key={iva.value} value={iva.value}>{iva.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Saldo */}
            <div className="min-w-[140px]">
              <label className="text-xs text-gray-500 mb-1 block">Saldo</label>
              <Select value={filtroSaldo} onValueChange={setFiltroSaldo}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="deudores">Deudores</SelectItem>
                  <SelectItem value="aldia">Al día</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Vendedor */}
            <div className="min-w-[170px]">
              <label className="text-xs text-gray-500 mb-1 block">Vendedor</label>
              <Select value={filtroVendedor} onValueChange={setFiltroVendedor}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="sin_asignar">Sin asignar</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Cotizaciones activas */}
            <div className="flex items-center gap-2 pb-1">
              <Checkbox
                id="cotizaciones"
                checked={filtroCotizaciones}
                onCheckedChange={(checked) => setFiltroCotizaciones(checked === true)}
              />
              <label htmlFor="cotizaciones" className="text-sm text-gray-600 cursor-pointer whitespace-nowrap">
                Con cotizaciones activas
              </label>
            </div>

            {/* Contador */}
            <span className="text-xs text-gray-500 pb-1 ml-auto whitespace-nowrap">
              {filtroCotizaciones ? `${displayCustomers.length} de ` : ''}{total} clientes
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card className="border-blue-200">
        <CardContent className="p-0">
          {loading && displayCustomers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-10 w-10 animate-spin text-blue-600 mb-3" />
              <p className="text-gray-500">Cargando clientes...</p>
            </div>
          ) : !loading && displayCustomers.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p>No se encontraron clientes con los filtros aplicados</p>
            </div>
          ) : (
            <>
              <div className={`overflow-x-auto transition-opacity ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-blue-50/50">
                      <TableHead
                        className="cursor-pointer hover:bg-blue-50 select-none"
                        onClick={() => handleSort('businessName')}
                      >
                        <span className="flex items-center font-semibold text-blue-900">
                          Razón Social <SortIcon field="businessName" />
                        </span>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-blue-50 select-none"
                        onClick={() => handleSort('cuit')}
                      >
                        <span className="flex items-center font-semibold text-blue-900">
                          CUIT <SortIcon field="cuit" />
                        </span>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-blue-50 select-none"
                        onClick={() => handleSort('taxCondition')}
                      >
                        <span className="flex items-center font-semibold text-blue-900">
                          Condición IVA <SortIcon field="taxCondition" />
                        </span>
                      </TableHead>
                      <TableHead
                        className="text-right cursor-pointer hover:bg-blue-50 select-none"
                        onClick={() => handleSort('balance')}
                      >
                        <span className="flex items-center justify-end font-semibold text-blue-900">
                          Saldo CC <SortIcon field="balance" />
                        </span>
                      </TableHead>
                      <TableHead>
                        <span className="font-semibold text-blue-900">Vendedor</span>
                      </TableHead>
                      <TableHead>
                        <span className="font-semibold text-blue-900">Última Actividad</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayCustomers.map((customer) => {
                      const cleanCuit = customer.cuit?.replace(/\D/g, '')
                      const activity = activityMap[cleanCuit]
                      const balance = Number(customer.balance) || 0
                      return (
                        <TableRow
                          key={customer.id}
                          className="cursor-pointer hover:bg-blue-50/50 transition-colors"
                          onClick={() => router.push(`/clientes/${customer.id}`)}
                        >
                          <TableCell>
                            <p className="font-medium text-gray-900">{customer.businessName || customer.name}</p>
                            {customer.businessName && customer.name !== customer.businessName && (
                              <p className="text-xs text-gray-400">{customer.name}</p>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {customer.cuit ? formatCUIT(customer.cuit) : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs font-normal">
                              {TAX_LABEL[customer.taxCondition] || customer.taxCondition || '—'}
                            </Badge>
                          </TableCell>
                          <TableCell className={`text-right font-mono text-sm font-semibold ${saldoIndicator(balance)}`}>
                            $ {formatNumber(balance)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {customer.salesPerson ? (
                              <span className="text-gray-700">{customer.salesPerson.name}</span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-gray-500">
                            {loadingActivity ? (
                              <span className="text-gray-300">...</span>
                            ) : activity?.lastActivity ? (
                              <div>
                                <span>{formatDateAR(activity.lastActivity)}</span>
                                {activity.activeQuotes > 0 && (
                                  <Badge className="ml-2 bg-blue-100 text-blue-700 text-xs">
                                    {activity.activeQuotes} activa{activity.activeQuotes > 1 ? 's' : ''}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Paginación */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(1)} disabled={page === 1}>
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(page - 1)} disabled={page === 1}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-gray-500 px-3">
                      Página <span className="font-semibold">{page}</span> de{' '}
                      <span className="font-semibold">{totalPages}</span>
                    </span>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(page + 1)} disabled={page === totalPages}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(totalPages)} disabled={page === totalPages}>
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <span className="text-xs text-gray-400">
                    {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} de {total}
                  </span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Modal de importación de asignaciones */}
      <ImportarAsignacionesModal
        open={showImportModal}
        onOpenChange={setShowImportModal}
        onSuccess={() => {
          setShowImportModal(false)
          fetchActivity(customers)
        }}
      />
    </div>
  )
}

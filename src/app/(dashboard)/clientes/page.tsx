'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
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
} from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber, formatCUIT, formatDateAR } from '@/lib/utils'

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface ColppyCustomer {
  id: string
  colppyId: string
  name: string
  businessName: string
  cuit: string
  taxCondition: string
  taxConditionDisplay: string
  saldo: number
  searchText: string
}

interface ActivityData {
  lastActivity: string | null
  activeQuotes: number
  localId: string | null
}

type SortField = 'businessName' | 'cuit' | 'taxConditionDisplay' | 'saldo' | 'lastActivity'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 50

// ─── Página ──────────────────────────────────────────────────────────────────

export default function ClientesPage() {
  const router = useRouter()

  // Data
  const [allCustomers, setAllCustomers] = useState<ColppyCustomer[]>([])
  const [activityMap, setActivityMap] = useState<Record<string, ActivityData>>({})
  const [loading, setLoading] = useState(true)
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [error, setError] = useState('')

  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [filtroIva, setFiltroIva] = useState('todas')
  const [filtroSaldo, setFiltroSaldo] = useState('todos')
  const [filtroCotizaciones, setFiltroCotizaciones] = useState(false)

  // Sort
  const [sortField, setSortField] = useState<SortField>('businessName')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Pagination
  const [page, setPage] = useState(1)

  // ─── Fetch customers ────────────────────────────────────────────────────────

  const fetchCustomers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/colppy/clientes?all=true')
      if (!res.ok) throw new Error('Error al cargar clientes de Colppy')
      const data = await res.json()
      setAllCustomers(data.customers || [])
    } catch (e: any) {
      setError(e.message || 'Error al cargar clientes')
      toast.error('Error al cargar clientes de Colppy')
    } finally {
      setLoading(false)
    }
  }, [])

  // ─── Fetch activity data ────────────────────────────────────────────────────

  const fetchActivity = useCallback(async (customers: ColppyCustomer[]) => {
    if (customers.length === 0) return
    setLoadingActivity(true)
    try {
      // Solo enviar CUITs que existen
      const cuits = customers
        .map((c) => c.cuit?.replace(/\D/g, ''))
        .filter((c) => c && c.length === 11)
        .slice(0, 500) // Limitar para no sobrecargar

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
      // No es crítico, silenciar
    } finally {
      setLoadingActivity(false)
    }
  }, [])

  useEffect(() => {
    fetchCustomers()
  }, [fetchCustomers])

  useEffect(() => {
    if (allCustomers.length > 0) {
      fetchActivity(allCustomers)
    }
  }, [allCustomers, fetchActivity])

  // ─── Refresh ────────────────────────────────────────────────────────────────

  const handleRefresh = async () => {
    setLoading(true)
    try {
      // Invalidar cache de Colppy
      await fetch('/api/colppy/clientes', { method: 'POST' })
      await fetchCustomers()
      toast.success('Cache de clientes actualizado')
    } catch {
      toast.error('Error al refrescar')
    }
  }

  // ─── Condiciones IVA únicas ─────────────────────────────────────────────────

  const ivaOptions = useMemo(() => {
    const set = new Set(allCustomers.map((c) => c.taxConditionDisplay).filter(Boolean))
    return [...set].sort()
  }, [allCustomers])

  // ─── Filtrar + Ordenar ──────────────────────────────────────────────────────

  const filteredCustomers = useMemo(() => {
    let result = [...allCustomers]

    // Búsqueda
    if (searchQuery.trim()) {
      const terms = searchQuery.toLowerCase().trim().split(/\s+/)
      result = result.filter((c) =>
        terms.every((t) => c.searchText.includes(t))
      )
    }

    // Filtro IVA
    if (filtroIva !== 'todas') {
      result = result.filter((c) => c.taxConditionDisplay === filtroIva)
    }

    // Filtro saldo
    if (filtroSaldo === 'deudores') {
      result = result.filter((c) => c.saldo > 0)
    } else if (filtroSaldo === 'aldia') {
      result = result.filter((c) => c.saldo <= 0)
    }

    // Filtro cotizaciones activas
    if (filtroCotizaciones) {
      result = result.filter((c) => {
        const cleanCuit = c.cuit?.replace(/\D/g, '')
        const activity = activityMap[cleanCuit]
        return activity && activity.activeQuotes > 0
      })
    }

    // Ordenar
    result.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'businessName':
          cmp = (a.businessName || a.name).localeCompare(b.businessName || b.name)
          break
        case 'cuit':
          cmp = (a.cuit || '').localeCompare(b.cuit || '')
          break
        case 'taxConditionDisplay':
          cmp = (a.taxConditionDisplay || '').localeCompare(b.taxConditionDisplay || '')
          break
        case 'saldo':
          cmp = a.saldo - b.saldo
          break
        case 'lastActivity': {
          const aAct = activityMap[a.cuit?.replace(/\D/g, '')]?.lastActivity || ''
          const bAct = activityMap[b.cuit?.replace(/\D/g, '')]?.lastActivity || ''
          cmp = aAct.localeCompare(bAct)
          break
        }
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [allCustomers, searchQuery, filtroIva, filtroSaldo, filtroCotizaciones, activityMap, sortField, sortDir])

  // ─── Paginación ─────────────────────────────────────────────────────────────

  const totalPages = Math.ceil(filteredCustomers.length / PAGE_SIZE)
  const currentPage = Math.min(page, totalPages || 1)
  const pagedCustomers = filteredCustomers.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )

  // Reset page on filter change
  useEffect(() => {
    setPage(1)
  }, [searchQuery, filtroIva, filtroSaldo, filtroCotizaciones])

  // ─── Sort handler ───────────────────────────────────────────────────────────

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir(field === 'saldo' ? 'desc' : 'asc')
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 text-gray-400 inline" />
    return sortDir === 'asc'
      ? <ArrowUp className="h-3 w-3 ml-1 text-blue-600 inline" />
      : <ArrowDown className="h-3 w-3 ml-1 text-blue-600 inline" />
  }

  // ─── Click handler ──────────────────────────────────────────────────────────

  const handleCustomerClick = (customer: ColppyCustomer) => {
    // Usar colppyId como identificador principal (más confiable que CUIT)
    const colppyId = customer.colppyId || customer.id
    if (colppyId) {
      router.push(`/clientes/${colppyId}`)
    } else {
      // Fallback: usar CUIT sin guiones
      const cleanCuit = customer.cuit?.replace(/\D/g, '')
      router.push(`/clientes/${cleanCuit}`)
    }
  }

  // ─── Saldo indicator ───────────────────────────────────────────────────────

  const saldoIndicator = (saldo: number) => {
    if (saldo <= 0) return 'text-green-600'
    if (saldo > 100000) return 'text-red-600'
    return 'text-yellow-600'
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-blue-900">Clientes</h1>
            <p className="text-gray-500 text-sm">
              {allCustomers.length > 0 ? `${allCustomers.length} clientes en Colppy` : 'Cargando...'}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={handleRefresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refrescar
        </Button>
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
                  {ivaOptions.map((iva) => (
                    <SelectItem key={iva} value={iva}>{iva}</SelectItem>
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
              {filteredCustomers.length} de {allCustomers.length}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card className="border-blue-200">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-10 w-10 animate-spin text-blue-600 mb-3" />
              <p className="text-gray-500">Cargando clientes de Colppy...</p>
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <p className="text-red-600 mb-3">{error}</p>
              <Button variant="outline" onClick={fetchCustomers}>Reintentar</Button>
            </div>
          ) : pagedCustomers.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p>No se encontraron clientes con los filtros aplicados</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
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
                        onClick={() => handleSort('taxConditionDisplay')}
                      >
                        <span className="flex items-center font-semibold text-blue-900">
                          Condición IVA <SortIcon field="taxConditionDisplay" />
                        </span>
                      </TableHead>
                      <TableHead
                        className="text-right cursor-pointer hover:bg-blue-50 select-none"
                        onClick={() => handleSort('saldo')}
                      >
                        <span className="flex items-center justify-end font-semibold text-blue-900">
                          Saldo CC <SortIcon field="saldo" />
                        </span>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-blue-50 select-none"
                        onClick={() => handleSort('lastActivity')}
                      >
                        <span className="flex items-center font-semibold text-blue-900">
                          Última Actividad <SortIcon field="lastActivity" />
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedCustomers.map((customer) => {
                      const cleanCuit = customer.cuit?.replace(/\D/g, '')
                      const activity = activityMap[cleanCuit]
                      return (
                        <TableRow
                          key={customer.id}
                          className="cursor-pointer hover:bg-blue-50/50 transition-colors"
                          onClick={() => handleCustomerClick(customer)}
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
                              {customer.taxConditionDisplay || '—'}
                            </Badge>
                          </TableCell>
                          <TableCell className={`text-right font-mono text-sm font-semibold ${saldoIndicator(customer.saldo)}`}>
                            $ {formatNumber(customer.saldo)}
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
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(1)} disabled={currentPage === 1}>
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-gray-500 px-3">
                      Página <span className="font-semibold">{currentPage}</span> de{' '}
                      <span className="font-semibold">{totalPages}</span>
                    </span>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(currentPage + 1)} disabled={currentPage === totalPages}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(totalPages)} disabled={currentPage === totalPages}>
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <span className="text-xs text-gray-400">
                    {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredCustomers.length)} de {filteredCustomers.length}
                  </span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Search,
  Loader2,
  Download,
  XCircle,
  DollarSign,
  FileText,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  BarChart3,
  ArrowUpDown,
} from 'lucide-react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'

// ============================================================================
// TYPES
// ============================================================================

interface Invoice {
  id: string
  invoiceNumber: string
  invoiceType: string
  issueDate: string
  dueDate: string
  customer: { id: string; name: string }
  salesPerson: { id: string; name: string }
  status: string
  paymentStatus: string
  currency: string
  exchangeRate: number | null
  subtotal: number
  taxAmount: number
  discount: number
  total: number
  colppyId: string | null
}

interface Resumen {
  totalUSD: number
  totalARS: number
  totalFacturas: number
  ticketPromedio: number
  variacionMesAnterior: number
}

interface ChartItem {
  name: string
  total: number
  qty?: number
}

interface MonthlyItem {
  month: string
  label: string
  total: number
}

interface AnalisisData {
  invoices: Invoice[]
  resumen: Resumen
  graficos: {
    facturacionMensual: MonthlyItem[]
    facturacionPorVendedor: ChartItem[]
    topClientes: ChartItem[]
    topProductos: ChartItem[]
    facturacionPorMarca: ChartItem[]
  }
  marcas: string[]
}

interface User {
  id: string
  name: string
}

// ============================================================================
// CONSTANTS
// ============================================================================

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#6366f1',
]

const statusLabels: Record<string, string> = {
  DRAFT: 'Borrador',
  PENDING: 'Pendiente',
  AUTHORIZED: 'Autorizada',
  SENT: 'Enviada',
  PAID: 'Pagada',
  OVERDUE: 'Vencida',
  CANCELLED: 'Cancelada',
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PENDING: 'bg-yellow-100 text-yellow-800',
  AUTHORIZED: 'bg-blue-100 text-blue-800',
  SENT: 'bg-blue-100 text-blue-800',
  PAID: 'bg-green-100 text-green-800',
  OVERDUE: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-800',
}

const paymentLabels: Record<string, string> = {
  UNPAID: 'Impaga',
  PARTIAL: 'Parcial',
  PAID: 'Pagada',
}

type SortField = 'invoiceNumber' | 'issueDate' | 'customer' | 'salesPerson' | 'total' | 'status'
type SortDir = 'asc' | 'desc'

// ============================================================================
// COMPONENT
// ============================================================================

export default function AnalisisFacturacionPage() {
  const [data, setData] = useState<AnalisisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [salesPersons, setSalesPersons] = useState<User[]>([])

  // Filtros
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [salesPersonId, setSalesPersonId] = useState('ALL')
  const [search, setSearch] = useState('')
  const [brand, setBrand] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')

  // Sort
  const [sortField, setSortField] = useState<SortField>('issueDate')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((d) => setSalesPersons(d.users || []))
      .catch(() => {})
  }, [])

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      if (salesPersonId !== 'ALL') params.append('salesPersonId', salesPersonId)
      if (search) params.append('search', search)
      if (brand !== 'ALL') params.append('brand', brand)
      if (statusFilter !== 'ALL') params.append('status', statusFilter)

      const url = `/api/facturacion/analisis${params.toString() ? `?${params}` : ''}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Error al cargar datos')
      const json = await res.json()
      setData(json)
    } catch {
      toast.error('Error al cargar análisis de facturación')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, salesPersonId, search, brand, statusFilter])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleClearFilters = () => {
    setSearch('')
    setStatusFilter('ALL')
    setDateFrom('')
    setDateTo('')
    setSalesPersonId('ALL')
    setBrand('ALL')
  }

  const hasActiveFilters =
    search !== '' || statusFilter !== 'ALL' || dateFrom !== '' || dateTo !== '' || salesPersonId !== 'ALL' || brand !== 'ALL'

  const handleSync = async () => {
    try {
      setSyncing(true)
      const body: Record<string, string> = {}
      if (dateFrom) body.dateFrom = dateFrom
      if (dateTo) body.dateTo = dateTo

      const res = await fetch('/api/facturacion/sync-colppy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al sincronizar')
      }

      const result = await res.json()
      const r = result.resumen
      toast.success(
        `Sincronización completada: ${r.created} nuevas, ${r.updated} actualizadas, ${r.skipped} omitidas`
      )
      fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al sincronizar desde Colppy')
    } finally {
      setSyncing(false)
    }
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const sortedInvoices = data?.invoices
    ? [...data.invoices].sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1
        switch (sortField) {
          case 'invoiceNumber': return a.invoiceNumber.localeCompare(b.invoiceNumber) * dir
          case 'issueDate': return (new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime()) * dir
          case 'customer': return a.customer.name.localeCompare(b.customer.name) * dir
          case 'salesPerson': return a.salesPerson.name.localeCompare(b.salesPerson.name) * dir
          case 'total': return (Number(a.total) - Number(b.total)) * dir
          case 'status': return a.status.localeCompare(b.status) * dir
          default: return 0
        }
      })
    : []

  const handleExportExcel = () => {
    if (!sortedInvoices.length) {
      toast.error('No hay facturas para exportar')
      return
    }

    const rows = sortedInvoices.map((inv) => ({
      'Nº Factura': inv.invoiceNumber,
      Tipo: inv.invoiceType,
      Fecha: new Date(inv.issueDate).toLocaleDateString('es-AR'),
      Vencimiento: new Date(inv.dueDate).toLocaleDateString('es-AR'),
      Cliente: inv.customer.name,
      Vendedor: inv.salesPerson.name,
      Estado: statusLabels[inv.status] || inv.status,
      Pago: paymentLabels[inv.paymentStatus] || inv.paymentStatus,
      Moneda: inv.currency,
      'TC': Number(inv.exchangeRate || 1),
      Subtotal: Number(inv.subtotal),
      IVA: Number(inv.taxAmount),
      Descuento: Number(inv.discount),
      Total: Number(inv.total),
      Colppy: inv.colppyId ? 'Sí' : 'No',
    }))

    const ws = XLSX.utils.json_to_sheet(rows)
    const colWidths = Object.keys(rows[0]).map((key) => {
      const maxLen = Math.max(key.length, ...rows.map((r) => String(r[key as keyof typeof r]).length))
      return { wch: maxLen + 2 }
    })
    ws['!cols'] = colWidths

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Facturación')

    const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
    XLSX.writeFile(wb, `Facturacion_VAL_ARG_${today}.xlsx`)
    toast.success('Excel descargado correctamente')
  }

  const fmt = (n: number, currency = 'USD') =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('es-AR', { year: 'numeric', month: 'short', day: 'numeric' })

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <TableHead
      className="font-semibold text-blue-900 cursor-pointer select-none hover:bg-blue-100"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        <ArrowUpDown className="h-3 w-3 opacity-50" />
      </div>
    </TableHead>
  )

  // Custom tooltip for charts
  const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="text-sm text-blue-600 font-semibold">{fmt(payload[0].value)}</p>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  const resumen = data?.resumen
  const graficos = data?.graficos

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-blue-900">Análisis de Facturación</h1>
          <p className="text-muted-foreground">Dashboard de facturación y métricas de venta</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleSync}
            disabled={syncing}
            className="border-purple-300 text-purple-700 hover:bg-purple-50"
          >
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Sincronizar desde Colppy
          </Button>
          <Button
            variant="outline"
            onClick={handleExportExcel}
            className="border-green-300 text-green-700 hover:bg-green-50"
          >
            <Download className="mr-2 h-4 w-4" />
            Descargar Excel
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card className="border-blue-200">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <div className="relative xl:col-span-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Nº factura, cliente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchData()}
                className="pl-10"
              />
            </div>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="Fecha desde" />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="Fecha hasta" />
            <Select value={salesPersonId} onValueChange={setSalesPersonId}>
              <SelectTrigger><SelectValue placeholder="Vendedor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los vendedores</SelectItem>
                {salesPersons.map((sp) => (
                  <SelectItem key={sp.id} value={sp.id}>{sp.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={brand} onValueChange={setBrand}>
              <SelectTrigger><SelectValue placeholder="Marca" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas las marcas</SelectItem>
                {(data?.marcas || []).map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los estados</SelectItem>
                <SelectItem value="PENDING">Pendiente</SelectItem>
                <SelectItem value="PAID">Pagada</SelectItem>
                <SelectItem value="CANCELLED">Cancelada</SelectItem>
                <SelectItem value="OVERDUE">Vencida</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={fetchData} className="bg-blue-600 hover:bg-blue-700">
              <Search className="mr-2 h-4 w-4" />
              Buscar
            </Button>
            {hasActiveFilters && (
              <Button variant="outline" onClick={handleClearFilters} className="text-gray-600">
                <XCircle className="mr-2 h-4 w-4" />
                Limpiar filtros
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Cards de resumen */}
      {resumen && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-blue-200">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100">
                  <DollarSign className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Facturado (USD)</p>
                  <p className="text-2xl font-bold text-blue-900">{fmt(resumen.totalUSD)}</p>
                  <p className="text-xs text-muted-foreground">{fmt(resumen.totalARS, 'ARS')} ARS</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-blue-200">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-100">
                  <FileText className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Cantidad de Facturas</p>
                  <p className="text-2xl font-bold text-green-900">{resumen.totalFacturas}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-blue-200">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-100">
                  <BarChart3 className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Ticket Promedio</p>
                  <p className="text-2xl font-bold text-purple-900">{fmt(resumen.ticketPromedio)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-blue-200">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${resumen.variacionMesAnterior >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                  {resumen.variacionMesAnterior >= 0 ? (
                    <TrendingUp className="h-5 w-5 text-green-600" />
                  ) : (
                    <TrendingDown className="h-5 w-5 text-red-600" />
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">vs Mes Anterior</p>
                  <p className={`text-2xl font-bold ${resumen.variacionMesAnterior >= 0 ? 'text-green-900' : 'text-red-900'}`}>
                    {resumen.variacionMesAnterior >= 0 ? '+' : ''}{resumen.variacionMesAnterior}%
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Gráficos */}
      {graficos && (
        <>
          {/* Facturación mensual */}
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-900">Facturación Mensual (USD) - Últimos 12 meses</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={graficos.facturacionMensual}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 12 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Fila 2: Vendedor + Marca */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-blue-200">
              <CardHeader>
                <CardTitle className="text-blue-900">Facturación por Vendedor (USD)</CardTitle>
              </CardHeader>
              <CardContent>
                {graficos.facturacionPorVendedor.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={graficos.facturacionPorVendedor}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="total"
                        nameKey="name"
                        label={(({ name, percent }: { name: string; percent?: number }) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`) as never}
                        labelLine={{ strokeWidth: 1 }}
                      >
                        {graficos.facturacionPorVendedor.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={((value: number) => fmt(value)) as never} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-center text-muted-foreground py-12">Sin datos</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-blue-200">
              <CardHeader>
                <CardTitle className="text-blue-900">Facturación por Marca (USD)</CardTitle>
              </CardHeader>
              <CardContent>
                {graficos.facturacionPorMarca.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={graficos.facturacionPorMarca.slice(0, 10)}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="total"
                        nameKey="name"
                        label={(({ name, percent }: { name: string; percent?: number }) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`) as never}
                        labelLine={{ strokeWidth: 1 }}
                      >
                        {graficos.facturacionPorMarca.slice(0, 10).map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={((value: number) => fmt(value)) as never} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-center text-muted-foreground py-12">Sin datos</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Fila 3: Top Clientes + Top Productos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-blue-200">
              <CardHeader>
                <CardTitle className="text-blue-900">Top 10 Clientes (USD)</CardTitle>
              </CardHeader>
              <CardContent>
                {graficos.topClientes.length > 0 ? (
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={graficos.topClientes} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={((value: number) => fmt(value)) as never} />
                      <Bar dataKey="total" fill="#10b981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-center text-muted-foreground py-12">Sin datos</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-blue-200">
              <CardHeader>
                <CardTitle className="text-blue-900">Top 10 Productos (USD)</CardTitle>
              </CardHeader>
              <CardContent>
                {graficos.topProductos.length > 0 ? (
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={graficos.topProductos} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={((value: number) => fmt(value)) as never} />
                      <Bar dataKey="total" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-center text-muted-foreground py-12">Sin datos</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Tabla detallada */}
      <Card className="border-blue-200">
        <CardHeader>
          <CardTitle className="text-blue-900">Listado de Facturas</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : sortedInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-lg">No se encontraron facturas</p>
            </div>
          ) : (
            <div className="rounded-lg border border-blue-100 overflow-hidden overflow-x-auto">
              <Table className="min-w-[1200px]">
                <TableHeader>
                  <TableRow className="bg-blue-50 hover:bg-blue-50">
                    <SortHeader field="invoiceNumber">Nº Factura</SortHeader>
                    <TableHead className="font-semibold text-blue-900">Tipo</TableHead>
                    <SortHeader field="issueDate">Fecha</SortHeader>
                    <SortHeader field="customer">Cliente</SortHeader>
                    <SortHeader field="salesPerson">Vendedor</SortHeader>
                    <SortHeader field="status">Estado</SortHeader>
                    <TableHead className="font-semibold text-blue-900">Pago</TableHead>
                    <TableHead className="font-semibold text-blue-900">Moneda</TableHead>
                    <SortHeader field="total">
                      <span className="text-right w-full">Total</span>
                    </SortHeader>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedInvoices.map((inv) => (
                    <TableRow key={inv.id} className="hover:bg-blue-50 transition-colors">
                      <TableCell className="font-mono text-sm font-medium text-blue-700">
                        {inv.invoiceNumber}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{inv.invoiceType}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">{fmtDate(inv.issueDate)}</TableCell>
                      <TableCell className="font-medium text-gray-900">{inv.customer.name}</TableCell>
                      <TableCell className="text-sm text-gray-600">{inv.salesPerson.name}</TableCell>
                      <TableCell>
                        <Badge className={statusColors[inv.status]}>
                          {statusLabels[inv.status] || inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            inv.paymentStatus === 'PAID'
                              ? 'bg-green-100 text-green-800'
                              : inv.paymentStatus === 'PARTIAL'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                          }
                        >
                          {paymentLabels[inv.paymentStatus] || inv.paymentStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{inv.currency}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {fmt(Number(inv.total), inv.currency === 'ARS' ? 'ARS' : 'USD')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

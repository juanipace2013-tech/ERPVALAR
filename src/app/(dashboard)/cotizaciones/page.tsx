'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  FileText,
  Plus,
  Search,
  MoreHorizontal,
  Eye,
  Edit,
  Copy,
  FileDown,
  Loader2,
  Download,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'

interface Quote {
  id: string
  quoteNumber: string
  date: string
  status: string
  currency: string
  subtotal: number
  bonification: number
  total: number
  exchangeRate: number
  customer: {
    id: string
    name: string
  }
  salesPerson: {
    id: string
    name: string
  }
  validUntil: string | null
}

interface User {
  id: string
  name: string
  email: string
  role: string
}

const statusLabels: Record<string, string> = {
  DRAFT: 'Borrador',
  SENT: 'Enviada',
  ACCEPTED: 'Aceptada',
  REJECTED: 'Rechazada',
  EXPIRED: 'Vencida',
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  SENT: 'bg-blue-100 text-blue-800',
  ACCEPTED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-orange-100 text-orange-800',
}

export default function CotizacionesPage() {
  const router = useRouter()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [salesPersonId, setSalesPersonId] = useState<string>('ALL')
  const [salesPersons, setSalesPersons] = useState<User[]>([])

  // Fetch vendedores al montar
  useEffect(() => {
    fetch('/api/users')
      .then((res) => res.json())
      .then((data) => setSalesPersons(data.users || []))
      .catch(() => {})
  }, [])

  const fetchQuotes = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (statusFilter !== 'ALL') params.append('status', statusFilter)
      if (search) params.append('search', search)
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      if (salesPersonId !== 'ALL') params.append('salesPersonId', salesPersonId)

      const url = `/api/quotes${params.toString() ? `?${params.toString()}` : ''}`
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error('Error al cargar cotizaciones')
      }

      const data = await response.json()
      setQuotes(data.quotes || [])
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar cotizaciones')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, search, dateFrom, dateTo, salesPersonId])

  useEffect(() => {
    fetchQuotes()
  }, [fetchQuotes])

  const handleSearch = () => {
    fetchQuotes()
  }

  const handleClearFilters = () => {
    setSearch('')
    setStatusFilter('ALL')
    setDateFrom('')
    setDateTo('')
    setSalesPersonId('ALL')
  }

  const hasActiveFilters =
    search !== '' ||
    statusFilter !== 'ALL' ||
    dateFrom !== '' ||
    dateTo !== '' ||
    salesPersonId !== 'ALL'

  const handleDownloadPDF = async (quoteId: string, quoteNumber: string) => {
    try {
      const response = await fetch(`/api/cotizaciones/${quoteId}/pdf`)
      if (!response.ok) throw new Error()
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Cotizacion-${quoteNumber}.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Error al generar PDF')
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const handleDuplicate = async (quoteId: string) => {
    try {
      const response = await fetch(`/api/quotes/${quoteId}/duplicate`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Error al duplicar cotización')
      }

      const data = await response.json()
      toast.success('Cotización duplicada exitosamente')
      router.push(`/cotizaciones/${data.id}`)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al duplicar cotización')
    }
  }

  const handleExportExcel = () => {
    if (quotes.length === 0) {
      toast.error('No hay cotizaciones para exportar')
      return
    }

    const data = quotes.map((q) => ({
      'Nº Cotización': q.quoteNumber,
      Fecha: new Date(q.date).toLocaleDateString('es-AR'),
      Cliente: q.customer.name,
      Vendedor: q.salesPerson.name,
      Estado: statusLabels[q.status] || q.status,
      'Subtotal USD': Number(q.subtotal),
      'Bonificación %': Number(q.bonification),
      'Total USD': Number(q.total),
      'Total ARS': Number((q.total * Number(q.exchangeRate)).toFixed(2)),
    }))

    const ws = XLSX.utils.json_to_sheet(data)

    // Autoajustar columnas
    const colWidths = Object.keys(data[0]).map((key) => {
      const maxLen = Math.max(
        key.length,
        ...data.map((row) => String(row[key as keyof typeof row]).length)
      )
      return { wch: maxLen + 2 }
    })
    ws['!cols'] = colWidths

    // Encabezados en negrita: aplicar estilo a primera fila
    // SheetJS community edition no soporta estilos nativos,
    // pero los encabezados se generan automáticamente por json_to_sheet

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Cotizaciones')

    const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
    XLSX.writeFile(wb, `Cotizaciones_VAL_ARG_${today}.xlsx`)
    toast.success('Excel descargado correctamente')
  }

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-AR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-blue-900">
            Cotizaciones
          </h1>
          <p className="text-muted-foreground">
            Gestión de cotizaciones y presupuestos
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleExportExcel}
            className="border-green-300 text-green-700 hover:bg-green-50"
          >
            <Download className="mr-2 h-4 w-4" />
            Descargar Excel
          </Button>
          <Link href="/cotizaciones/nueva">
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="mr-2 h-4 w-4" />
              Nueva Cotización
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-blue-200">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {/* Búsqueda por texto */}
            <div className="relative xl:col-span-2">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por número, cliente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyPress={handleKeyPress}
                className="pl-10"
              />
            </div>
            {/* Fecha desde */}
            <div>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                placeholder="Desde"
                className="w-full"
                title="Fecha desde"
              />
            </div>
            {/* Fecha hasta */}
            <div>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                placeholder="Hasta"
                className="w-full"
                title="Fecha hasta"
              />
            </div>
            {/* Vendedor */}
            <div>
              <Select value={salesPersonId} onValueChange={setSalesPersonId}>
                <SelectTrigger>
                  <SelectValue placeholder="Vendedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos los vendedores</SelectItem>
                  {salesPersons.map((sp) => (
                    <SelectItem key={sp.id} value={sp.id}>
                      {sp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Estado */}
            <div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos los estados</SelectItem>
                  <SelectItem value="DRAFT">Borrador</SelectItem>
                  <SelectItem value="SENT">Enviada</SelectItem>
                  <SelectItem value="ACCEPTED">Aceptada</SelectItem>
                  <SelectItem value="REJECTED">Rechazada</SelectItem>
                  <SelectItem value="EXPIRED">Vencida</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {/* Botones de acción de filtros */}
          <div className="flex gap-2 mt-4">
            <Button
              onClick={handleSearch}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Search className="mr-2 h-4 w-4" />
              Buscar
            </Button>
            {hasActiveFilters && (
              <Button
                variant="outline"
                onClick={handleClearFilters}
                className="text-gray-600"
              >
                <XCircle className="mr-2 h-4 w-4" />
                Limpiar filtros
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-blue-200">
        <CardContent className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : quotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-lg">
                {hasActiveFilters ? 'No se encontraron cotizaciones' : 'No hay cotizaciones'}
              </p>
              {!hasActiveFilters && (
                <Link href="/cotizaciones/nueva">
                  <Button className="mt-4 bg-blue-600 hover:bg-blue-700">
                    <Plus className="mr-2 h-4 w-4" />
                    Crear primera cotización
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-blue-100 overflow-hidden overflow-x-auto">
              <Table className="min-w-[1100px]">
                <TableHeader>
                  <TableRow className="bg-blue-50 hover:bg-blue-50">
                    <TableHead className="min-w-[130px] font-semibold text-blue-900">
                      Nº Cotización
                    </TableHead>
                    <TableHead className="min-w-[200px] font-semibold text-blue-900">
                      Cliente
                    </TableHead>
                    <TableHead className="min-w-[120px] font-semibold text-blue-900">
                      Fecha
                    </TableHead>
                    <TableHead className="min-w-[120px] font-semibold text-blue-900">
                      Vendedor
                    </TableHead>
                    <TableHead className="min-w-[130px] text-right font-semibold text-blue-900">
                      Total
                    </TableHead>
                    <TableHead className="min-w-[90px] font-semibold text-blue-900">
                      Estado
                    </TableHead>
                    <TableHead className="min-w-[110px] font-semibold text-blue-900">
                      Vigencia
                    </TableHead>
                    <TableHead className="w-[60px] font-semibold text-blue-900">
                      Ver
                    </TableHead>
                    <TableHead className="w-[60px] text-right font-semibold text-blue-900">
                      Acciones
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotes.map((quote) => (
                    <TableRow
                      key={quote.id}
                      className="cursor-pointer hover:bg-blue-50 transition-colors"
                      onClick={() => router.push(`/cotizaciones/${quote.id}`)}
                    >
                      <TableCell className="font-mono text-sm font-medium text-blue-700">
                        {quote.quoteNumber}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-gray-900">
                          {quote.customer.name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-gray-600">
                          {formatDate(quote.date)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-gray-600">
                          {quote.salesPerson.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="font-semibold">
                          {formatCurrency(quote.total, quote.currency)}
                        </div>
                        {quote.currency === 'USD' && (
                          <div className="text-xs text-muted-foreground">
                            {formatCurrency(
                              quote.total * Number(quote.exchangeRate),
                              'ARS'
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColors[quote.status]}>
                          {statusLabels[quote.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {quote.validUntil ? (
                          <span className="text-sm text-gray-600">
                            {formatDate(quote.validUntil)}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/cotizaciones/${quote.id}/ver`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-blue-600 hover:text-blue-800 hover:bg-blue-100"
                            title="Ver detalle"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation()
                                router.push(`/cotizaciones/${quote.id}`)
                              }}
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDuplicate(quote.id)
                              }}
                            >
                              <Copy className="mr-2 h-4 w-4" />
                              Duplicar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDownloadPDF(quote.id, quote.quoteNumber)
                              }}
                            >
                              <FileDown className="mr-2 h-4 w-4" />
                              Descargar PDF
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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

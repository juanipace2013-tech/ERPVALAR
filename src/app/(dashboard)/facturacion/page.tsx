'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Loader2,
  Receipt,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  CircleDot,
  Clock,
  CheckCircle2,
  AlertCircle,
  Send,
  RefreshCw,
  History,
  FileText,
  Truck,
  Eye,
  ChevronLeft,
  Calendar as CalendarIcon,
  MessageSquare,
  Pencil,
} from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'
import { formatCurrency, formatNumber, formatCUIT } from '@/lib/utils'
import {
  SendToColppyDialog,
  type ColppySendPayload,
} from '@/components/quotes/SendToColppyDialog'
import { BillingScheduleDialog } from '@/components/facturacion/BillingScheduleDialog'
import { refreshInventoryCache } from '@/hooks/useColppyStock'

// ─── Helpers ─────────────────────────────────────────

// "Hoy civil" para el usuario, expresado en el mismo formato que guardamos
// billingTargetDate: 12:00 UTC del día civil local. Se compara contra
// billingTargetDate (también guardado a 12:00 UTC) para evitar off-by-one
// por timezone.
function todayCivilUtcMs(): number {
  const now = new Date()
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0)
}

// Formatea un Date/ISO como DD/MM/YYYY tomando los componentes UTC,
// porque billingTargetDate es una fecha civil pinchada a 12:00 UTC.
function formatBillingDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function isBillingDue(iso: string | null): boolean {
  if (!iso) return false
  const target = new Date(iso).getTime()
  if (isNaN(target)) return false
  return target <= todayCivilUtcMs()
}

const TC_BADGE_COLORS: Record<string, string> = {
  'TC Billete SIN IVA': 'bg-amber-100 text-amber-800 border-amber-300',
  'TC Billete CON IVA': 'bg-yellow-100 text-yellow-800 border-yellow-300',
  'TC Divisa': 'bg-blue-100 text-blue-800 border-blue-300',
  'TC MEP': 'bg-purple-100 text-purple-800 border-purple-300',
}

function getTCBadgeClass(type: string): string {
  return TC_BADGE_COLORS[type] || 'bg-orange-100 text-orange-800 border-orange-300'
}

// ─── Types ───────────────────────────────────────────

interface AdditionalStockInfo {
  sku: string | null
  name: string | null
  stockQuantity: number | null
  hasStock: boolean
  shortage: number | null
}

interface BoardItem {
  id: string
  itemNumber: number
  description: string
  productSku: string | null
  quantity: number
  invoicedQuantity: number
  remainingQuantity: number
  unitPrice: number
  totalPrice: number
  deliveryTime: string | null
  isInStock: boolean
  isAlternative: boolean
  sentToColppy: boolean
  stockQuantity: number | null
  stockShortage: number | null
  additionals: AdditionalStockInfo[]
}

interface BoardCard {
  id: string
  quoteNumber: string
  customer: {
    id: string
    name: string
    cuit: string
    taxCondition: string | null
    paymentTerms: number | null
    exchangeRateType: string | null
  }
  salesPerson: { id: string; name: string }
  currency: 'USD' | 'ARS'
  total: number
  exchangeRate: number
  terms: string | null
  notes: string | null
  date: string
  readyItemsCount: number
  totalItemsCount: number
  farthestDelivery: string
  items: BoardItem[]
  column: 'ready' | 'partial' | 'pending'
  colppySyncedAt: string | null
  colppyInvoiceId: string | null
  billingTargetDate: string | null
  billingNote: string | null
  billingNoteUpdatedAt: string | null
  billingNoteUpdatedByName: string | null
}

interface ColumnData {
  quotes: BoardCard[]
  count: number
  totalUSD: number
  totalARS: number
}

interface BoardData {
  columns: {
    ready: ColumnData
    partial: ColumnData
    pending: ColumnData
  }
  filters: {
    vendedores: Array<{ id: string; name: string }>
    clientes: Array<{ id: string; name: string }>
  }
}

interface HistorialItem {
  id: string
  date: string
  colppyRef: string
  quoteNumber: string
  customer: { id: string; name: string; cuit: string }
  salesPerson: { id: string; name: string } | null
  currency: string
  totalUSD: number | null
  totalARS: number | null
  isFactura: boolean
  isRemito: boolean
  status: string
}

interface HistorialData {
  historial: HistorialItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  filters: {
    vendedores: Array<{ id: string; name: string }>
    clientes: Array<{ id: string; name: string }>
  }
}

// ─── Main Component ──────────────────────────────────

export default function FacturacionPage() {
  const [boardData, setBoardData] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(true)

  // Filters
  const [vendedorFilter, setVendedorFilter] = useState('all')
  const [clienteFilter, setClienteFilter] = useState('')
  const [monedaFilter, setMonedaFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Expanded cards
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())

  // Selected items for partial invoicing
  const [selectedItems, setSelectedItems] = useState<Map<string, Set<string>>>(new Map())

  // Stock refresh
  const [refreshingStock, setRefreshingStock] = useState(false)

  // Colppy dialog state
  const [showColppyDialog, setShowColppyDialog] = useState(false)
  const [colppyQuoteId, setColppyQuoteId] = useState<string | null>(null)

  // Billing schedule dialog state
  const [billingScheduleQuote, setBillingScheduleQuote] = useState<BoardCard | null>(null)

  // Historial state
  const [historialData, setHistorialData] = useState<HistorialData | null>(null)
  const [historialLoading, setHistorialLoading] = useState(false)
  const [historialVendedor, setHistorialVendedor] = useState('all')
  const [historialCliente, setHistorialCliente] = useState('')
  const [historialDateFrom, setHistorialDateFrom] = useState('')
  const [historialDateTo, setHistorialDateTo] = useState('')
  const [historialPage, setHistorialPage] = useState(0)

  useEffect(() => {
    fetchBoard()
    fetchHistorial()
  }, [])

  const fetchBoard = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (vendedorFilter !== 'all') params.append('vendedorId', vendedorFilter)
      if (clienteFilter) params.append('clienteId', clienteFilter)
      if (monedaFilter !== 'all') params.append('moneda', monedaFilter)
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)

      const response = await fetch(`/api/facturacion/board?${params.toString()}`)
      if (!response.ok) throw new Error('Error al cargar tablero')

      const data = (await response.json()) as BoardData
      // Subir al tope de cada columna las cards con billingTargetDate vencida
      // (today >= billingTargetDate). El resto del orden se preserva.
      const todayMs = todayCivilUtcMs()
      const sortByBillingDue = (a: BoardCard, b: BoardCard) => {
        const aDue = a.billingTargetDate ? new Date(a.billingTargetDate).getTime() <= todayMs : false
        const bDue = b.billingTargetDate ? new Date(b.billingTargetDate).getTime() <= todayMs : false
        if (aDue === bDue) return 0
        return aDue ? -1 : 1
      }
      data.columns.ready.quotes = [...data.columns.ready.quotes].sort(sortByBillingDue)
      data.columns.partial.quotes = [...data.columns.partial.quotes].sort(sortByBillingDue)
      data.columns.pending.quotes = [...data.columns.pending.quotes].sort(sortByBillingDue)
      setBoardData(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar tablero de facturación')
    } finally {
      setLoading(false)
    }
  }

  const fetchHistorial = async (page = historialPage) => {
    try {
      setHistorialLoading(true)
      const params = new URLSearchParams()
      if (historialVendedor !== 'all') params.append('vendedorId', historialVendedor)
      if (historialCliente) params.append('clienteId', historialCliente)
      if (historialDateFrom) params.append('dateFrom', historialDateFrom)
      if (historialDateTo) params.append('dateTo', historialDateTo)
      params.append('page', String(page))

      const response = await fetch(`/api/facturacion/historial?${params.toString()}`)
      if (!response.ok) throw new Error('Error al cargar historial')

      const data = await response.json()
      setHistorialData(data)
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setHistorialLoading(false)
    }
  }

  const handleApplyFilters = () => {
    fetchBoard()
  }

  const handleRefreshStock = async () => {
    try {
      setRefreshingStock(true)

      // Paso 1: Sincronizar stock desde Colppy → persiste stockQuantity en DB
      const result = await refreshInventoryCache()
      if (!result.success) {
        toast.error('Error al actualizar stock desde Colppy')
        return
      }

      const sync = result.stockSync
      if (sync) {
        toast.success(
          `Stock sincronizado: ${sync.updated} productos actualizados, ${sync.unchanged} sin cambios`
        )
      } else {
        toast.success(`Stock actualizado: ${result.total} productos desde Colppy`)
      }

      // Paso 2: Recargar el tablero (ahora stockQuantity en DB está actualizado)
      await fetchBoard()
    } catch (error) {
      console.error('Error refreshing stock:', error)
      toast.error('Error al actualizar stock desde Colppy')
    } finally {
      setRefreshingStock(false)
    }
  }

  const toggleCard = (cardId: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev)
      if (next.has(cardId)) {
        next.delete(cardId)
      } else {
        next.add(cardId)
      }
      return next
    })
  }

  const toggleItemSelection = (quoteId: string, itemId: string) => {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      const quoteItems = new Set(next.get(quoteId) || [])
      if (quoteItems.has(itemId)) {
        quoteItems.delete(itemId)
      } else {
        quoteItems.add(itemId)
      }
      next.set(quoteId, quoteItems)
      return next
    })
  }

  const selectAllReadyItems = (quote: BoardCard) => {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      const readyIds = quote.items
        .filter((i) => i.isInStock && i.remainingQuantity > 0 && !i.sentToColppy)
        .map((i) => i.id)
      next.set(quote.id, new Set(readyIds))
      return next
    })
  }

  // Get selected items for a given quote (for the dialog)
  const getItemsForColppy = useCallback(
    (quoteId: string): BoardItem[] | null => {
      if (!boardData) return null
      const allQuotes = [
        ...boardData.columns.ready.quotes,
        ...boardData.columns.partial.quotes,
        ...boardData.columns.pending.quotes,
      ]
      const quote = allQuotes.find((q) => q.id === quoteId)
      if (!quote) return null

      const selected = selectedItems.get(quote.id)

      if (quote.column === 'ready') {
        return quote.items.filter((i) => i.remainingQuantity > 0 && !i.sentToColppy)
      }

      // Partial/pending: only selected items
      if (!selected || selected.size === 0) return null
      return quote.items.filter((i) => selected.has(i.id) && i.remainingQuantity > 0)
    },
    [boardData, selectedItems]
  )

  // Open the Colppy dialog for a specific quote
  const openColppyDialog = (quoteId: string) => {
    setColppyQuoteId(quoteId)
    setShowColppyDialog(true)
  }

  // Build the quote prop for SendToColppyDialog
  const getColppyDialogQuote = useCallback(() => {
    if (!colppyQuoteId || !boardData) return null
    const allQuotes = [
      ...boardData.columns.ready.quotes,
      ...boardData.columns.partial.quotes,
      ...boardData.columns.pending.quotes,
    ]
    const quote = allQuotes.find((q) => q.id === colppyQuoteId)
    if (!quote) return null

    const itemsToSend = getItemsForColppy(colppyQuoteId)
    if (!itemsToSend || itemsToSend.length === 0) return null

    return {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      customer: {
        name: quote.customer.name,
        cuit: quote.customer.cuit,
        taxCondition: quote.customer.taxCondition || '',
        idCondicionPago: quote.customer.paymentTerms != null
          ? String(quote.customer.paymentTerms)
          : '0',
      },
      items: itemsToSend.map((item) => ({
        id: item.id,
        productSku: item.productSku || '',
        description: item.description,
        quantity: item.remainingQuantity,
        unitPrice: item.unitPrice,
        iva: 21,
      })),
      total: quote.total,
      currency: quote.currency,
      exchangeRate: quote.exchangeRate,
      notes: quote.notes ?? undefined,
    }
  }, [colppyQuoteId, boardData, getItemsForColppy])

  // Custom send handler for the facturación flow
  const handleColppySend = useCallback(
    async (payload: ColppySendPayload) => {
      if (!colppyQuoteId) throw new Error('No se seleccionó cotización')

      const itemsToSend = getItemsForColppy(colppyQuoteId)
      if (!itemsToSend) throw new Error('No hay ítems para enviar')

      const response = await fetch('/api/facturacion/generate-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId: colppyQuoteId,
          items: itemsToSend.map((i) => ({
            quoteItemId: i.id,
            quantity: i.remainingQuantity,
          })),
          action: payload.action,
          editedData: payload.editedData,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Error al enviar a Colppy')
      }

      // Construir mensaje de éxito
      const successParts: string[] = []
      if (data.remitoNumber) {
        successParts.push(`Remito: ${data.remitoNumber}`)
      }
      if (data.facturaNumber) {
        successParts.push(`Factura: ${data.facturaNumber}`)
      }

      toast.success('Enviado a Colppy', {
        description: successParts.join(' | ') || 'Borrador creado exitosamente',
      })

      setSelectedItems(new Map())
    },
    [colppyQuoteId, getItemsForColppy]
  )

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  const formatDateTime = (date: string) => {
    return new Date(date).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // ─── Render ──────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Cargando tablero de facturación...</p>
        </div>
      </div>
    )
  }

  if (!boardData) {
    return (
      <div className="container mx-auto px-6 py-8">
        <Card>
          <CardContent className="text-center py-12">
            <Receipt className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600">No se pudo cargar el tablero</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { columns, filters } = boardData
  const colppyDialogQuote = getColppyDialogQuote()

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Facturación</h1>
          <p className="text-gray-600 mt-1">
            Tablero de cotizaciones aceptadas — envío de borradores a Colppy
          </p>
        </div>
        <Button variant="outline" onClick={handleRefreshStock} disabled={refreshingStock}>
          {refreshingStock ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {refreshingStock ? 'Sincronizando...' : 'Actualizar Stock'}
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-700">Listas para Facturar</p>
                <p className="text-2xl font-bold text-green-800">{columns.ready.count}</p>
                <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                  {columns.ready.totalUSD > 0 && (
                    <p>USD {formatNumber(columns.ready.totalUSD)}</p>
                  )}
                  {columns.ready.totalARS > 0 && (
                    <p>ARS {formatNumber(columns.ready.totalARS)}</p>
                  )}
                </div>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-yellow-700">Facturación Parcial</p>
                <p className="text-2xl font-bold text-yellow-800">{columns.partial.count}</p>
                <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                  {columns.partial.totalUSD > 0 && (
                    <p>USD {formatNumber(columns.partial.totalUSD)}</p>
                  )}
                  {columns.partial.totalARS > 0 && (
                    <p>ARS {formatNumber(columns.partial.totalARS)}</p>
                  )}
                </div>
              </div>
              <Clock className="h-8 w-8 text-yellow-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-red-500">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-red-700">Pendientes</p>
                <p className="text-2xl font-bold text-red-800">{columns.pending.count}</p>
                <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                  {columns.pending.totalUSD > 0 && (
                    <p>USD {formatNumber(columns.pending.totalUSD)}</p>
                  )}
                  {columns.pending.totalARS > 0 && (
                    <p>ARS {formatNumber(columns.pending.totalARS)}</p>
                  )}
                </div>
              </div>
              <AlertCircle className="h-8 w-8 text-red-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div>
              <Label className="text-xs text-gray-500">Vendedor</Label>
              <Select value={vendedorFilter} onValueChange={setVendedorFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {filters.vendedores.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-500">Moneda</Label>
              <Select value={monedaFilter} onValueChange={setMonedaFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="ARS">ARS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-500">Desde</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs text-gray-500">Hasta</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9"
              />
            </div>
            <Button onClick={handleApplyFilters} className="h-9">
              Filtrar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <KanbanColumn
          title="Listas para Facturar"
          emoji="🟢"
          colorScheme="green"
          data={columns.ready}
          expandedCards={expandedCards}
          selectedItems={selectedItems}
          onToggleCard={toggleCard}
          onToggleItem={toggleItemSelection}
          onSelectAllReady={selectAllReadyItems}
          onSendToColppy={openColppyDialog}
          onEditBilling={(quote) => setBillingScheduleQuote(quote)}
          formatDate={formatDate}
          formatDateTime={formatDateTime}
        />
        <KanbanColumn
          title="Facturación Parcial"
          emoji="🟡"
          colorScheme="yellow"
          data={columns.partial}
          expandedCards={expandedCards}
          selectedItems={selectedItems}
          onToggleCard={toggleCard}
          onToggleItem={toggleItemSelection}
          onSelectAllReady={selectAllReadyItems}
          onSendToColppy={openColppyDialog}
          onEditBilling={(quote) => setBillingScheduleQuote(quote)}
          formatDate={formatDate}
          formatDateTime={formatDateTime}
        />
        <KanbanColumn
          title="Pendientes"
          emoji="🔴"
          colorScheme="red"
          data={columns.pending}
          expandedCards={expandedCards}
          selectedItems={selectedItems}
          onToggleCard={toggleCard}
          onToggleItem={toggleItemSelection}
          onSelectAllReady={selectAllReadyItems}
          onSendToColppy={openColppyDialog}
          onEditBilling={(quote) => setBillingScheduleQuote(quote)}
          formatDate={formatDate}
          formatDateTime={formatDateTime}
        />
      </div>

      {/* ─── Últimas Facturas Enviadas a Colppy ─── */}
      <Card className="mt-8">
        <div className="p-6 pb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <History className="h-5 w-5 text-blue-600" />
              Últimas Facturas Enviadas a Colppy
              {historialData && (
                <span className="text-sm font-normal text-gray-500">
                  {historialData.total} registros
                </span>
              )}
            </h2>
          </div>

          {/* Filtros historial */}
          <div className="flex flex-wrap gap-3 items-end border rounded-lg p-3 bg-gray-50 mb-4">
            <div className="w-40">
              <Label className="text-xs text-gray-500">Vendedor</Label>
              <Select value={historialVendedor} onValueChange={setHistorialVendedor}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {historialData?.filters.vendedores.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-48">
              <Label className="text-xs text-gray-500">Cliente</Label>
              <Select value={historialCliente || 'all'} onValueChange={(v) => setHistorialCliente(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {historialData?.filters.clientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-500">Desde</Label>
              <Input
                type="date"
                value={historialDateFrom}
                onChange={(e) => setHistorialDateFrom(e.target.value)}
                className="h-9 w-36"
              />
            </div>
            <div>
              <Label className="text-xs text-gray-500">Hasta</Label>
              <Input
                type="date"
                value={historialDateTo}
                onChange={(e) => setHistorialDateTo(e.target.value)}
                className="h-9 w-36"
              />
            </div>
            <Button size="sm" onClick={() => { setHistorialPage(0); fetchHistorial(0) }} className="h-9">
              Filtrar
            </Button>
            {(historialVendedor !== 'all' || historialCliente || historialDateFrom || historialDateTo) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-xs"
                onClick={() => {
                  setHistorialVendedor('all')
                  setHistorialCliente('')
                  setHistorialDateFrom('')
                  setHistorialDateTo('')
                  setHistorialPage(0)
                  setTimeout(() => fetchHistorial(0), 0)
                }}
              >
                Limpiar
              </Button>
            )}
          </div>

          {/* Tabla historial */}
          {historialLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
          ) : !historialData || historialData.historial.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Receipt className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No hay facturas enviadas a Colppy</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Nº Factura / Remito</TableHead>
                      <TableHead>Cotización</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>CUIT</TableHead>
                      <TableHead>Vendedor</TableHead>
                      <TableHead className="text-right">Total USD</TableHead>
                      <TableHead className="text-right">Total ARS</TableHead>
                      <TableHead className="text-center">Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historialData.historial.map((item) => (
                      <TableRow key={item.id} className="hover:bg-blue-50/30">
                        <TableCell className="whitespace-nowrap text-sm">
                          {new Date(item.date).toLocaleDateString('es-AR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </TableCell>
                        <TableCell className="font-mono text-sm font-medium">
                          {item.colppyRef}
                        </TableCell>
                        <TableCell className="text-sm">
                          <Link
                            href={`/cotizaciones/${item.id}/ver`}
                            className="text-blue-600 hover:underline"
                          >
                            {item.quoteNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm font-medium max-w-[200px] truncate" title={item.customer.name}>
                          {item.customer.name}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {formatCUIT(item.customer.cuit)}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {item.salesPerson?.name || '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {item.totalUSD != null ? `USD ${formatNumber(item.totalUSD)}` : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {item.totalARS != null ? `$ ${formatNumber(item.totalARS)}` : '—'}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            {item.isFactura && (
                              <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-xs">
                                <FileText className="h-3 w-3 mr-1" />
                                Factura
                              </Badge>
                            )}
                            {item.isRemito && (
                              <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 text-xs">
                                <Truck className="h-3 w-3 mr-1" />
                                Remito
                              </Badge>
                            )}
                            {!item.isFactura && !item.isRemito && (
                              <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-xs">
                                Facturado
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/cotizaciones/${item.id}/ver`}>
                              <Eye className="h-4 w-4 mr-1" /> Ver
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Paginación */}
              {historialData.totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t mt-4">
                  <p className="text-sm text-gray-500">
                    Mostrando {historialData.page * historialData.pageSize + 1}–{Math.min((historialData.page + 1) * historialData.pageSize, historialData.total)} de {historialData.total}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={historialData.page <= 0}
                      onClick={() => {
                        const newPage = historialPage - 1
                        setHistorialPage(newPage)
                        fetchHistorial(newPage)
                      }}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Anterior
                    </Button>
                    <span className="text-sm text-gray-600">
                      Página {historialData.page + 1} de {historialData.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={historialData.page >= historialData.totalPages - 1}
                      onClick={() => {
                        const newPage = historialPage + 1
                        setHistorialPage(newPage)
                        fetchHistorial(newPage)
                      }}
                    >
                      Siguiente
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      {/* Reutilizar el mismo dialog de Cotizaciones */}
      {colppyDialogQuote && (
        <SendToColppyDialog
          quote={colppyDialogQuote}
          open={showColppyDialog}
          onOpenChange={setShowColppyDialog}
          onSent={() => {
            setShowColppyDialog(false)
            fetchBoard()
            fetchHistorial()
          }}
          onSend={handleColppySend}
          subtitle={`Facturación parcial: ${colppyDialogQuote.items.length} ítem(s) seleccionados`}
        />
      )}

      {/* Programación de facturación */}
      <BillingScheduleDialog
        open={billingScheduleQuote !== null}
        quoteId={billingScheduleQuote?.id ?? null}
        quoteNumber={billingScheduleQuote?.quoteNumber ?? null}
        initial={
          billingScheduleQuote
            ? {
                billingTargetDate: billingScheduleQuote.billingTargetDate,
                billingNote: billingScheduleQuote.billingNote,
                billingNoteUpdatedAt: billingScheduleQuote.billingNoteUpdatedAt,
                billingNoteUpdatedByName: billingScheduleQuote.billingNoteUpdatedByName,
              }
            : null
        }
        onClose={() => setBillingScheduleQuote(null)}
        onSaved={() => fetchBoard()}
      />
    </div>
  )
}

// ─── Kanban Column Component ────────────────────────

interface KanbanColumnProps {
  title: string
  emoji: string
  colorScheme: 'green' | 'yellow' | 'red'
  data: ColumnData
  expandedCards: Set<string>
  selectedItems: Map<string, Set<string>>
  onToggleCard: (id: string) => void
  onToggleItem: (quoteId: string, itemId: string) => void
  onSelectAllReady: (quote: BoardCard) => void
  onSendToColppy: (quoteId: string) => void
  onEditBilling: (quote: BoardCard) => void
  formatDate: (date: string) => string
  formatDateTime: (date: string) => string
}

const columnColors = {
  green: {
    header: 'bg-green-50 border-green-200',
    badge: 'bg-green-100 text-green-800',
    border: 'border-green-300',
  },
  yellow: {
    header: 'bg-yellow-50 border-yellow-200',
    badge: 'bg-yellow-100 text-yellow-800',
    border: 'border-yellow-300',
  },
  red: {
    header: 'bg-red-50 border-red-200',
    badge: 'bg-red-100 text-red-800',
    border: 'border-red-300',
  },
}

function KanbanColumn({
  title,
  emoji,
  colorScheme,
  data,
  expandedCards,
  selectedItems,
  onToggleCard,
  onToggleItem,
  onSelectAllReady,
  onSendToColppy,
  onEditBilling,
  formatDate,
  formatDateTime,
}: KanbanColumnProps) {
  const colors = columnColors[colorScheme]

  return (
    <div className="flex flex-col">
      <div className={`rounded-t-lg border p-3 ${colors.header}`}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">
            {emoji} {title}
          </h3>
          <Badge className={colors.badge}>{data.count}</Badge>
        </div>
      </div>

      <div className="border border-t-0 rounded-b-lg bg-gray-50/50 p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-420px)] overflow-y-auto">
        {data.quotes.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400">
            Sin cotizaciones
          </div>
        ) : (
          data.quotes.map((quote) => (
            <QuoteCard
              key={quote.id}
              quote={quote}
              isExpanded={expandedCards.has(quote.id)}
              selectedItems={selectedItems.get(quote.id) || new Set()}
              onToggle={() => onToggleCard(quote.id)}
              onToggleItem={(itemId) => onToggleItem(quote.id, itemId)}
              onSelectAllReady={() => onSelectAllReady(quote)}
              onSendToColppy={() => onSendToColppy(quote.id)}
              onEditBilling={() => onEditBilling(quote)}
              formatDate={formatDate}
              formatDateTime={formatDateTime}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ─── Quote Card Component ───────────────────────────

interface QuoteCardProps {
  quote: BoardCard
  isExpanded: boolean
  selectedItems: Set<string>
  onToggle: () => void
  onToggleItem: (itemId: string) => void
  onSelectAllReady: () => void
  onSendToColppy: () => void
  onEditBilling: () => void
  formatDate: (date: string) => string
  formatDateTime: (date: string) => string
}

function QuoteCard({
  quote,
  isExpanded,
  selectedItems,
  onToggle,
  onToggleItem,
  onSelectAllReady,
  onSendToColppy,
  onEditBilling,
  formatDate,
  formatDateTime,
}: QuoteCardProps) {
  const hasSelectedItems = selectedItems.size > 0
  const allSentToColppy = quote.colppySyncedAt !== null
  const hasUnsent = quote.items.some((i) => i.remainingQuantity > 0 && !i.sentToColppy)

  // Estado de programación de facturación (comparación de fechas civiles)
  const billingDue = isBillingDue(quote.billingTargetDate)
  const billingScheduled = quote.billingTargetDate !== null && !billingDue
  const billingBorderClass = billingDue
    ? 'border-l-4 border-l-green-500'
    : billingScheduled
    ? 'border-l-4 border-l-blue-400'
    : ''

  return (
    <Card className={`shadow-sm ${billingBorderClass}`}>
      <div
        className="p-3 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-1.5">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
            )}
            <span className="font-mono font-semibold text-sm">{quote.quoteNumber}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEditBilling() }}
              className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"
              title="Programar facturación"
              aria-label="Programar facturación"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
          <span className="font-semibold text-sm">
            {formatCurrency(quote.total, quote.currency)}
          </span>
        </div>

        <div className="ml-5.5 space-y-1">
          <p className="text-sm font-medium text-gray-800 truncate">{quote.customer.name}</p>
          <div className="flex items-center gap-2">
            <p className="text-xs text-gray-500 font-mono">{formatCUIT(quote.customer.cuit)}</p>
            {quote.customer.exchangeRateType && (
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${getTCBadgeClass(quote.customer.exchangeRateType)}`}>
                {quote.customer.exchangeRateType}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-gray-500 pt-1">
            <span>
              {quote.readyItemsCount}/{quote.totalItemsCount} ítems listos
            </span>
            <span>{formatDate(quote.date)}</span>
          </div>

          {(() => {
            const warnings: Array<{ key: string; text: string }> = []
            for (const i of quote.items) {
              if (i.remainingQuantity <= 0) continue
              if (i.stockShortage != null && i.stockShortage > 0) {
                warnings.push({ key: `${i.id}-main`, text: `⚠ ${i.productSku || i.description}: faltan ${i.stockShortage} un.` })
              }
              for (const a of (i.additionals || [])) {
                if (a.shortage != null && a.shortage > 0) {
                  warnings.push({ key: `${i.id}-${a.sku}`, text: `⚠ ${a.sku || a.name || 'Adicional'}: ${a.stockQuantity === 0 || a.stockQuantity == null ? 'sin stock' : `faltan ${a.shortage} un.`}` })
                }
              }
            }
            if (warnings.length === 0) return null
            return (
              <div className="text-[10px] text-red-600 bg-red-50 rounded px-1.5 py-1 mt-0.5 space-y-0.5">
                {warnings.slice(0, 3).map((w) => (
                  <p key={w.key}>{w.text}</p>
                ))}
                {warnings.length > 3 && (
                  <p>...y {warnings.length - 3} más</p>
                )}
              </div>
            )
          })()}

          {quote.farthestDelivery !== 'Inmediato' && (
            <div className="flex items-center gap-1 text-xs text-orange-600">
              <Clock className="h-3 w-3" />
              <span>Plazo máx: {quote.farthestDelivery}</span>
            </div>
          )}

          {(quote.billingTargetDate || quote.billingNote) && (
            <div className={`text-xs rounded px-1.5 py-1 mt-0.5 space-y-0.5 ${
              billingDue
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-blue-50 text-blue-800 border border-blue-200'
            }`}>
              {quote.billingTargetDate && (
                <div className="flex items-center gap-1">
                  <CalendarIcon className="h-3 w-3 flex-shrink-0" />
                  <span>
                    {billingDue ? 'Listo para facturar' : 'Facturar el'}{' '}
                    {formatBillingDate(quote.billingTargetDate)}
                  </span>
                </div>
              )}
              {quote.billingNote && (
                <div className="flex items-start gap-1">
                  <MessageSquare className="h-3 w-3 flex-shrink-0 mt-[2px]" />
                  <span className="break-words">{quote.billingNote}</span>
                </div>
              )}
            </div>
          )}

          {quote.terms && (
            <p className="text-xs text-gray-400 truncate">Pago: {quote.terms}</p>
          )}

          {quote.colppySyncedAt && (
            <div className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 rounded px-1.5 py-0.5 mt-1">
              <Send className="h-3 w-3" />
              <span>Enviado a Colppy — {formatDateTime(quote.colppySyncedAt)}</span>
            </div>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t px-3 pb-3 pt-2 space-y-2">
          <div className="space-y-1">
            {quote.items.map((item) => {
              const isFullyInvoiced = item.remainingQuantity <= 0
              const canSelect =
                quote.column === 'partial' && item.isInStock && !isFullyInvoiced && !item.sentToColppy

              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 p-1.5 rounded text-xs ${
                    isFullyInvoiced
                      ? 'opacity-50 bg-gray-100'
                      : item.sentToColppy
                      ? 'bg-blue-50 border border-blue-200'
                      : 'bg-white border'
                  }`}
                >
                  {quote.column === 'partial' && (
                    <div className="flex-shrink-0 w-5">
                      {canSelect ? (
                        <Checkbox
                          checked={selectedItems.has(item.id)}
                          onCheckedChange={() => onToggleItem(item.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : null}
                    </div>
                  )}

                  <div className="flex-shrink-0">
                    {isFullyInvoiced ? (
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        Facturado
                      </Badge>
                    ) : item.sentToColppy ? (
                      <Badge className="text-[10px] px-1 py-0 bg-blue-100 text-blue-800 hover:bg-blue-100">
                        En Colppy
                      </Badge>
                    ) : item.isInStock ? (
                      <CircleDot className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <CircleDot className="h-3.5 w-3.5 text-red-400" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">
                      {item.productSku && (
                        <span className="font-mono text-gray-500">
                          {[item.productSku, ...item.additionals.filter(a => a.sku).map(a => a.sku)].join(' + ')}{' '}
                        </span>
                      )}
                      {item.description}
                    </p>
                    {!item.isInStock && !isFullyInvoiced && !item.sentToColppy && (
                      <div className="space-y-0.5">
                        {item.stockShortage != null && (
                          <p className="text-[10px] text-red-500">
                            ⚠ {item.productSku || 'Principal'}: faltan {item.stockShortage} un. (stock: {item.stockQuantity ?? 0})
                          </p>
                        )}
                        {item.additionals.filter(a => a.shortage != null && a.shortage > 0).map((a, idx) => (
                          <p key={idx} className="text-[10px] text-red-500">
                            ⚠ {a.sku || a.name || 'Adicional'}: {a.stockQuantity === 0 || a.stockQuantity == null ? 'sin stock' : `faltan ${a.shortage} un. (stock: ${a.stockQuantity})`}
                          </p>
                        ))}
                        {item.stockShortage == null && item.additionals.every(a => !a.shortage) && (
                          <p className="text-[10px] text-red-500">
                            {item.stockQuantity != null
                              ? `Stock: ${item.stockQuantity} / Necesita: ${item.remainingQuantity}`
                              : item.deliveryTime || 'Sin stock'}
                          </p>
                        )}
                      </div>
                    )}
                    {item.invoicedQuantity > 0 && !isFullyInvoiced && (
                      <p className="text-[10px] text-blue-500">
                        {item.remainingQuantity}/{item.quantity} pendientes
                      </p>
                    )}
                  </div>

                  <div className="text-right flex-shrink-0">
                    <p className="font-mono">{item.remainingQuantity > 0 ? item.remainingQuantity : item.quantity}</p>
                  </div>
                  <div className="text-right flex-shrink-0 w-20">
                    <p className="font-mono">
                      {formatNumber(item.unitPrice * (item.remainingQuantity > 0 ? item.remainingQuantity : item.quantity))}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" size="sm" className="text-xs" asChild>
              <Link href={`/cotizaciones/${quote.id}/ver`}>
                <ExternalLink className="h-3 w-3 mr-1" />
                Ver Cotización
              </Link>
            </Button>

            {quote.column === 'ready' && !allSentToColppy && (
              <Button
                size="sm"
                className="text-xs bg-blue-600 hover:bg-blue-700"
                onClick={(e) => {
                  e.stopPropagation()
                  onSelectAllReady()
                  onSendToColppy()
                }}
              >
                <Send className="h-3 w-3 mr-1" />
                Enviar a Colppy
              </Button>
            )}

            {quote.column === 'ready' && allSentToColppy && (
              <Badge className="text-xs bg-blue-100 text-blue-800 hover:bg-blue-100">
                <Send className="h-3 w-3 mr-1" />
                Enviado a Colppy
              </Badge>
            )}

            {quote.column === 'partial' && (
              <>
                {hasUnsent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectAllReady()
                    }}
                  >
                    Seleccionar listos
                  </Button>
                )}
                {hasSelectedItems && (
                  <Button
                    size="sm"
                    className="text-xs bg-blue-600 hover:bg-blue-700"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSendToColppy()
                    }}
                  >
                    <Send className="h-3 w-3 mr-1" />
                    Enviar Parcial ({selectedItems.size})
                  </Button>
                )}
                {allSentToColppy && !hasUnsent && (
                  <Badge className="text-xs bg-blue-100 text-blue-800 hover:bg-blue-100">
                    <Send className="h-3 w-3 mr-1" />
                    Ítems listos enviados
                  </Badge>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

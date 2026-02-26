'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Loader2,
  Receipt,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  CircleDot,
  Clock,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, formatNumber, formatCUIT } from '@/lib/utils'

// ─── Types ───────────────────────────────────────────

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
}

interface BoardCard {
  id: string
  quoteNumber: string
  customer: { id: string; name: string; cuit: string }
  salesPerson: { id: string; name: string }
  currency: 'USD' | 'ARS'
  total: number
  exchangeRate: number
  terms: string | null
  date: string
  readyItemsCount: number
  totalItemsCount: number
  farthestDelivery: string
  items: BoardItem[]
  column: 'ready' | 'partial' | 'pending'
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

  // Invoice dialog
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false)
  const [invoiceQuoteId, setInvoiceQuoteId] = useState<string | null>(null)
  const [invoicePointOfSale, setInvoicePointOfSale] = useState('0001')
  const [invoiceDueDate, setInvoiceDueDate] = useState('')
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [invoiceLoading, setInvoiceLoading] = useState(false)

  useEffect(() => {
    fetchBoard()
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

      const data = await response.json()
      setBoardData(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar tablero de facturación')
    } finally {
      setLoading(false)
    }
  }

  const handleApplyFilters = () => {
    fetchBoard()
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
        .filter((i) => i.isInStock && i.remainingQuantity > 0)
        .map((i) => i.id)
      next.set(quote.id, new Set(readyIds))
      return next
    })
  }

  const openInvoiceDialog = (quoteId: string) => {
    setInvoiceQuoteId(quoteId)
    setInvoicePointOfSale('0001')
    const due = new Date()
    due.setDate(due.getDate() + 30)
    setInvoiceDueDate(due.toISOString().split('T')[0])
    setInvoiceNotes('')
    setShowInvoiceDialog(true)
  }

  const getInvoiceItems = (): { quote: BoardCard; items: BoardItem[] } | null => {
    if (!invoiceQuoteId || !boardData) return null
    const allQuotes = [
      ...boardData.columns.ready.quotes,
      ...boardData.columns.partial.quotes,
      ...boardData.columns.pending.quotes,
    ]
    const quote = allQuotes.find((q) => q.id === invoiceQuoteId)
    if (!quote) return null

    const selected = selectedItems.get(quote.id)

    if (quote.column === 'ready') {
      // All remaining items
      return { quote, items: quote.items.filter((i) => i.remainingQuantity > 0) }
    }

    // Partial: only selected items
    if (!selected || selected.size === 0) return null
    return {
      quote,
      items: quote.items.filter((i) => selected.has(i.id) && i.remainingQuantity > 0),
    }
  }

  const handleGenerateInvoice = async () => {
    const data = getInvoiceItems()
    if (!data) return

    try {
      setInvoiceLoading(true)
      const response = await fetch('/api/facturacion/generate-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId: data.quote.id,
          items: data.items.map((i) => ({
            quoteItemId: i.id,
            quantity: i.remainingQuantity,
          })),
          pointOfSale: invoicePointOfSale,
          dueDate: invoiceDueDate || undefined,
          notes: invoiceNotes || undefined,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al generar factura')
      }

      const invoice = await response.json()
      toast.success(`Factura ${invoice.invoiceNumber} generada correctamente`)
      setShowInvoiceDialog(false)
      setSelectedItems(new Map())
      fetchBoard()
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al generar factura')
    } finally {
      setInvoiceLoading(false)
    }
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
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

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Facturación</h1>
        <p className="text-gray-600 mt-1">
          Tablero de cotizaciones aceptadas pendientes de facturación
        </p>
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
        {/* Ready Column */}
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
          onGenerateInvoice={openInvoiceDialog}
          formatDate={formatDate}
        />

        {/* Partial Column */}
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
          onGenerateInvoice={openInvoiceDialog}
          formatDate={formatDate}
        />

        {/* Pending Column */}
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
          onGenerateInvoice={openInvoiceDialog}
          formatDate={formatDate}
        />
      </div>

      {/* Invoice Generation Dialog */}
      <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Generar Factura</DialogTitle>
            <DialogDescription>
              {(() => {
                const data = getInvoiceItems()
                if (!data) return 'Seleccione ítems para facturar'
                return `Cotización ${data.quote.quoteNumber} — ${data.items.length} ítem(s)`
              })()}
            </DialogDescription>
          </DialogHeader>

          {(() => {
            const data = getInvoiceItems()
            if (!data) return null

            const subtotal = data.items.reduce(
              (sum, i) => sum + i.unitPrice * i.remainingQuantity,
              0
            )

            return (
              <div className="space-y-4 py-2">
                <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 text-sm">
                  <p>
                    <span className="text-gray-500">Cliente:</span>{' '}
                    <span className="font-medium">{data.quote.customer.name}</span>
                  </p>
                  <p>
                    <span className="text-gray-500">Moneda:</span> {data.quote.currency}
                  </p>
                  <div className="border-t pt-1.5 mt-1.5">
                    {data.items.map((item) => (
                      <div key={item.id} className="flex justify-between text-xs py-0.5">
                        <span className="truncate mr-2">
                          {item.remainingQuantity}x {item.description}
                        </span>
                        <span className="font-mono whitespace-nowrap">
                          {formatNumber(item.unitPrice * item.remainingQuantity)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t pt-1.5 flex justify-between font-semibold">
                    <span>Subtotal</span>
                    <span>
                      {data.quote.currency} {formatNumber(subtotal)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="pos">Punto de Venta</Label>
                    <Input
                      id="pos"
                      value={invoicePointOfSale}
                      onChange={(e) => setInvoicePointOfSale(e.target.value)}
                      maxLength={4}
                    />
                  </div>
                  <div>
                    <Label htmlFor="dueDate">Fecha Vencimiento</Label>
                    <Input
                      id="dueDate"
                      type="date"
                      value={invoiceDueDate}
                      onChange={(e) => setInvoiceDueDate(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="notes">Notas (opcional)</Label>
                  <Textarea
                    id="notes"
                    value={invoiceNotes}
                    onChange={(e) => setInvoiceNotes(e.target.value)}
                    rows={2}
                    placeholder="Notas adicionales..."
                  />
                </div>
              </div>
            )
          })()}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowInvoiceDialog(false)}
              disabled={invoiceLoading}
            >
              Cancelar
            </Button>
            <Button onClick={handleGenerateInvoice} disabled={invoiceLoading || !getInvoiceItems()}>
              {invoiceLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Generar Factura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  onGenerateInvoice: (quoteId: string) => void
  formatDate: (date: string) => string
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
  onGenerateInvoice,
  formatDate,
}: KanbanColumnProps) {
  const colors = columnColors[colorScheme]

  return (
    <div className="flex flex-col">
      {/* Column Header */}
      <div className={`rounded-t-lg border p-3 ${colors.header}`}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">
            {emoji} {title}
          </h3>
          <Badge className={colors.badge}>{data.count}</Badge>
        </div>
      </div>

      {/* Cards Container */}
      <div className={`border border-t-0 rounded-b-lg bg-gray-50/50 p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-420px)] overflow-y-auto`}>
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
              onGenerateInvoice={() => onGenerateInvoice(quote.id)}
              formatDate={formatDate}
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
  onGenerateInvoice: () => void
  formatDate: (date: string) => string
}

function QuoteCard({
  quote,
  isExpanded,
  selectedItems,
  onToggle,
  onToggleItem,
  onSelectAllReady,
  onGenerateInvoice,
  formatDate,
}: QuoteCardProps) {
  const hasSelectedItems = selectedItems.size > 0

  return (
    <Card className="shadow-sm">
      {/* Collapsed View */}
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
          </div>
          <span className="font-semibold text-sm">
            {formatCurrency(quote.total, quote.currency)}
          </span>
        </div>

        <div className="ml-5.5 space-y-1">
          <p className="text-sm font-medium text-gray-800 truncate">{quote.customer.name}</p>
          <p className="text-xs text-gray-500 font-mono">{formatCUIT(quote.customer.cuit)}</p>

          <div className="flex items-center justify-between text-xs text-gray-500 pt-1">
            <span>
              {quote.readyItemsCount}/{quote.totalItemsCount} ítems listos
            </span>
            <span>{formatDate(quote.date)}</span>
          </div>

          {quote.farthestDelivery !== 'Inmediato' && (
            <div className="flex items-center gap-1 text-xs text-orange-600">
              <Clock className="h-3 w-3" />
              <span>Plazo máx: {quote.farthestDelivery}</span>
            </div>
          )}

          {quote.terms && (
            <p className="text-xs text-gray-400 truncate">Pago: {quote.terms}</p>
          )}
        </div>
      </div>

      {/* Expanded View */}
      {isExpanded && (
        <div className="border-t px-3 pb-3 pt-2 space-y-2">
          {/* Items table */}
          <div className="space-y-1">
            {quote.items.map((item) => {
              const isFullyInvoiced = item.remainingQuantity <= 0
              const canSelect =
                quote.column === 'partial' && item.isInStock && !isFullyInvoiced

              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 p-1.5 rounded text-xs ${
                    isFullyInvoiced ? 'opacity-50 bg-gray-100' : 'bg-white border'
                  }`}
                >
                  {/* Checkbox (only for partial column, in-stock items) */}
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

                  {/* Stock indicator */}
                  <div className="flex-shrink-0">
                    {isFullyInvoiced ? (
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        Facturado
                      </Badge>
                    ) : item.isInStock ? (
                      <CircleDot className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <CircleDot className="h-3.5 w-3.5 text-red-400" />
                    )}
                  </div>

                  {/* Description */}
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{item.description}</p>
                    {!item.isInStock && !isFullyInvoiced && item.deliveryTime && (
                      <p className="text-[10px] text-red-500">{item.deliveryTime}</p>
                    )}
                    {item.invoicedQuantity > 0 && !isFullyInvoiced && (
                      <p className="text-[10px] text-blue-500">
                        {item.remainingQuantity}/{item.quantity} pendientes
                      </p>
                    )}
                  </div>

                  {/* Quantity + Price */}
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

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" size="sm" className="text-xs" asChild>
              <Link href={`/cotizaciones/${quote.id}/ver`}>
                <ExternalLink className="h-3 w-3 mr-1" />
                Ver Cotización
              </Link>
            </Button>

            {quote.column === 'ready' && (
              <Button
                size="sm"
                className="text-xs bg-green-600 hover:bg-green-700"
                onClick={(e) => {
                  e.stopPropagation()
                  // Select all remaining items for invoicing
                  onSelectAllReady()
                  onGenerateInvoice()
                }}
              >
                <FileText className="h-3 w-3 mr-1" />
                Generar Factura
              </Button>
            )}

            {quote.column === 'partial' && (
              <>
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
                {hasSelectedItems && (
                  <Button
                    size="sm"
                    className="text-xs bg-yellow-600 hover:bg-yellow-700"
                    onClick={(e) => {
                      e.stopPropagation()
                      onGenerateInvoice()
                    }}
                  >
                    <FileText className="h-3 w-3 mr-1" />
                    Facturar Parcial ({selectedItems.size})
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

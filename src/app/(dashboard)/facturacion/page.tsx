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
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, formatNumber, formatCUIT } from '@/lib/utils'
import {
  SendToColppyDialog,
  type ColppySendPayload,
} from '@/components/quotes/SendToColppyDialog'

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
  sentToColppy: boolean
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

  // Colppy dialog state
  const [showColppyDialog, setShowColppyDialog] = useState(false)
  const [colppyQuoteId, setColppyQuoteId] = useState<string | null>(null)

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
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Facturación</h1>
        <p className="text-gray-600 mt-1">
          Tablero de cotizaciones aceptadas — envío de borradores a Colppy
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
          formatDate={formatDate}
          formatDateTime={formatDateTime}
        />
      </div>

      {/* Reutilizar el mismo dialog de Cotizaciones */}
      {colppyDialogQuote && (
        <SendToColppyDialog
          quote={colppyDialogQuote}
          open={showColppyDialog}
          onOpenChange={setShowColppyDialog}
          onSent={() => {
            setShowColppyDialog(false)
            fetchBoard()
          }}
          onSend={handleColppySend}
          subtitle={`Facturación parcial: ${colppyDialogQuote.items.length} ítem(s) seleccionados`}
        />
      )}
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
  formatDate,
  formatDateTime,
}: QuoteCardProps) {
  const hasSelectedItems = selectedItems.size > 0
  const allSentToColppy = quote.colppySyncedAt !== null
  const hasUnsent = quote.items.some((i) => i.remainingQuantity > 0 && !i.sentToColppy)

  return (
    <Card className="shadow-sm">
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
                    <p className="truncate font-medium">{item.description}</p>
                    {!item.isInStock && !isFullyInvoiced && !item.sentToColppy && item.deliveryTime && (
                      <p className="text-[10px] text-red-500">{item.deliveryTime}</p>
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

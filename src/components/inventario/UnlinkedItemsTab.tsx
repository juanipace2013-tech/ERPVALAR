'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Loader2, Link2, AlertCircle, Check, Search, X } from 'lucide-react'
import { toast } from 'sonner'

interface Suggestion {
  id: string; sku: string; name: string; brand: string | null; matchType: string
}

interface UnlinkedItem {
  id: string
  supplierProductCode: string | null
  description: string
  quantity: number
  unitPrice: number
  purchaseInvoice: {
    id: string
    invoiceNumber: string
    invoiceDate: string
    supplierName: string
  }
  suggestions: Suggestion[]
}

interface InvoiceGroup {
  invoiceId: string
  invoiceNumber: string
  invoiceDate: string
  supplierName: string
  items: UnlinkedItem[]
}

interface UnlinkedData {
  totalUnlinked: number
  invoices: InvoiceGroup[]
}

interface SearchResult {
  id: string; sku: string; name: string; brand: string | null;
  supplier: { name: string } | null
}

const formatCurrency = (amount: number) =>
  `$${amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const formatDate = (date: string | null | undefined) =>
  date ? new Date(date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

// ---- Product Search Combobox ----
function ProductSearchCombobox({
  itemId,
  suggestions,
  selectedProduct,
  onSelect,
  onClear,
}: {
  itemId: string
  suggestions: Suggestion[]
  selectedProduct: { id: string; sku: string; name: string } | null
  onSelect: (product: { id: string; sku: string; name: string }) => void
  onClear: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const searchProducts = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const res = await fetch(`/api/inventory/search-products?q=${encodeURIComponent(q)}`)
      if (res.ok) {
        const data = await res.json()
        setResults(data.products || [])
      }
    } catch {
      // ignore
    } finally {
      setSearching(false)
    }
  }, [])

  const handleQueryChange = (val: string) => {
    setQuery(val)
    setShowDropdown(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchProducts(val), 300)
  }

  const handleSelect = (product: { id: string; sku: string; name: string }) => {
    onSelect(product)
    setQuery('')
    setResults([])
    setShowDropdown(false)
  }

  if (selectedProduct) {
    return (
      <div className="flex items-center gap-1 bg-green-50 border border-green-200 rounded px-2 py-1">
        <Check className="h-3 w-3 text-green-600 flex-shrink-0" />
        <span className="font-mono text-xs text-green-800 truncate">{selectedProduct.sku}</span>
        <span className="text-xs text-green-700 truncate">{selectedProduct.name.substring(0, 25)}</span>
        <button onClick={onClear} className="ml-auto text-green-600 hover:text-red-500 flex-shrink-0">
          <X className="h-3 w-3" />
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
        <Input
          className="h-8 text-xs pl-7 pr-2"
          placeholder="Buscar SKU o nombre..."
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => setShowDropdown(true)}
        />
        {searching && (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-gray-400" />
        )}
      </div>

      {showDropdown && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
          {/* Auto suggestions */}
          {suggestions.length > 0 && query.length < 2 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 uppercase bg-gray-50">
                Sugerencias automáticas
              </div>
              {suggestions.map(s => (
                <button
                  key={`sug-${s.id}`}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center gap-2 text-xs border-b border-gray-50"
                  onClick={() => handleSelect(s)}
                >
                  <span className="font-mono text-blue-700 flex-shrink-0">{s.sku}</span>
                  <span className="truncate text-gray-700">{s.name}</span>
                  <Badge variant="outline" className="text-[9px] ml-auto flex-shrink-0">{s.matchType}</Badge>
                </button>
              ))}
            </>
          )}

          {/* Search results */}
          {query.length >= 2 && results.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 uppercase bg-gray-50">
                Resultados de búsqueda
              </div>
              {results.map(r => (
                <button
                  key={`res-${r.id}`}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center gap-2 text-xs border-b border-gray-50"
                  onClick={() => handleSelect(r)}
                >
                  <span className="font-mono text-blue-700 flex-shrink-0">{r.sku}</span>
                  <span className="truncate text-gray-700">{r.name}</span>
                  {r.brand && <span className="text-gray-400 text-[10px] flex-shrink-0">{r.brand}</span>}
                </button>
              ))}
            </>
          )}

          {/* No results */}
          {query.length >= 2 && results.length === 0 && !searching && (
            <div className="px-3 py-3 text-xs text-gray-500 text-center">
              No se encontraron productos para &ldquo;{query}&rdquo;
            </div>
          )}

          {/* Empty state when no suggestions and no search */}
          {suggestions.length === 0 && query.length < 2 && (
            <div className="px-3 py-3 text-xs text-gray-400 text-center">
              Escribí 2+ caracteres para buscar
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---- Main Component ----
export default function UnlinkedItemsTab({ onCountUpdate }: { onCountUpdate?: (count: number) => void }) {
  const [data, setData] = useState<UnlinkedData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedLinks, setSelectedLinks] = useState<Record<string, { id: string; sku: string; name: string }>>({})
  const [linking, setLinking] = useState(false)
  const [linkedItems, setLinkedItems] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/inventory/unlinked-items')
      if (!res.ok) throw new Error()
      const result: UnlinkedData = await res.json()
      setData(result)
      onCountUpdate?.(result.totalUnlinked)
    } catch {
      toast.error('Error al cargar items sin vincular')
    } finally {
      setLoading(false)
    }
  }

  const handleLinkSingle = async (itemId: string, productId: string) => {
    try {
      const res = await fetch('/api/inventory/link-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ links: [{ purchaseInvoiceItemId: itemId, productId }] }),
      })
      if (!res.ok) throw new Error()
      toast.success('Item vinculado correctamente')
      setLinkedItems(prev => new Set([...prev, itemId]))
      // Update count
      if (data) {
        onCountUpdate?.(data.totalUnlinked - linkedItems.size - 1)
      }
    } catch {
      toast.error('Error al vincular item')
    }
  }

  const handleLinkSelected = async () => {
    const links = Object.entries(selectedLinks)
      .filter(([itemId]) => !linkedItems.has(itemId))
      .map(([purchaseInvoiceItemId, product]) => ({ purchaseInvoiceItemId, productId: product.id }))

    if (links.length === 0) {
      toast.error('Seleccione al menos un producto para vincular')
      return
    }

    try {
      setLinking(true)
      const res = await fetch('/api/inventory/link-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ links }),
      })

      if (!res.ok) throw new Error()
      const result = await res.json()
      toast.success(`${result.linked} items vinculados correctamente`)
      setSelectedLinks({})
      setLinkedItems(new Set())
      fetchData()
    } catch {
      toast.error('Error al vincular items')
    } finally {
      setLinking(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!data || data.totalUnlinked === 0) {
    return (
      <div className="text-center py-12">
        <Check className="h-12 w-12 text-green-500 mx-auto mb-4" />
        <p className="text-gray-600 font-medium">Todos los items están vinculados</p>
        <p className="text-sm text-gray-500 mt-1">No hay items de facturas de compra pendientes de vincular a productos del catálogo.</p>
      </div>
    )
  }

  const selectedCount = Object.keys(selectedLinks).filter(id => !linkedItems.has(id)).length

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-yellow-600" />
          <span className="font-medium">{data.totalUnlinked - linkedItems.size} items sin vincular</span>
          <span className="text-sm text-gray-500">en {data.invoices.length} facturas</span>
        </div>
        {selectedCount > 0 && (
          <Button onClick={handleLinkSelected} disabled={linking} className="bg-blue-600 hover:bg-blue-700">
            {linking ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Vinculando...</>
            ) : (
              <><Link2 className="h-4 w-4 mr-2" />Vincular {selectedCount} seleccionados</>
            )}
          </Button>
        )}
      </div>

      {/* Invoice Groups */}
      {data.invoices.map(inv => {
        // Check if all items in this invoice are linked
        const allLinked = inv.items.every(item => linkedItems.has(item.id))
        if (allLinked) return null

        return (
          <Card key={inv.invoiceId}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <div>
                  <span className="font-mono">{inv.invoiceNumber}</span>
                  <span className="text-gray-500 ml-2">{inv.supplierName}</span>
                </div>
                <span className="text-xs text-gray-400">{formatDate(inv.invoiceDate)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Cód. Proveedor</TableHead>
                    <TableHead className="text-xs">Descripción</TableHead>
                    <TableHead className="text-right text-xs">Cant.</TableHead>
                    <TableHead className="text-right text-xs">P. Unit.</TableHead>
                    <TableHead className="text-xs w-[300px]">Vincular con...</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inv.items.map(item => {
                    if (linkedItems.has(item.id)) {
                      return (
                        <TableRow key={item.id} className="bg-green-50/50">
                          <TableCell className="font-mono text-xs text-green-700">
                            {item.supplierProductCode || '-'}
                          </TableCell>
                          <TableCell className="text-sm text-green-700">{item.description}</TableCell>
                          <TableCell className="text-right text-sm text-green-700">{item.quantity}</TableCell>
                          <TableCell className="text-right text-sm text-green-700">{formatCurrency(item.unitPrice)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 text-green-600 text-xs">
                              <Check className="h-4 w-4" />
                              <span>Vinculado</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    }

                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-xs">
                          {item.supplierProductCode || '-'}
                        </TableCell>
                        <TableCell className="text-sm">{item.description}</TableCell>
                        <TableCell className="text-right text-sm">{item.quantity}</TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(item.unitPrice)}</TableCell>
                        <TableCell>
                          <ProductSearchCombobox
                            itemId={item.id}
                            suggestions={item.suggestions}
                            selectedProduct={selectedLinks[item.id] || null}
                            onSelect={(product) => {
                              setSelectedLinks(prev => ({ ...prev, [item.id]: product }))
                              // Auto-link immediately
                              handleLinkSingle(item.id, product.id)
                            }}
                            onClear={() => {
                              setSelectedLinks(prev => {
                                const next = { ...prev }
                                delete next[item.id]
                                return next
                              })
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

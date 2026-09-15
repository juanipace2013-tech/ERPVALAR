'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Loader2, Check, Search, X } from 'lucide-react'

export interface ProductSuggestion {
  id: string; sku: string; name: string; brand: string | null; matchType: string
}

export interface ProductSearchResult {
  id: string; sku: string; name: string; brand: string | null;
  supplier: { name: string } | null
}

/**
 * Buscador de productos (SKU o nombre) con sugerencias automáticas opcionales.
 * Se usa para vincular items de facturas de compra a productos del catálogo,
 * tanto en Inventario > Items sin vincular como en el detalle de la factura.
 */
export function ProductSearchCombobox({
  suggestions,
  selectedProduct,
  onSelect,
  onClear,
}: {
  suggestions: ProductSuggestion[]
  selectedProduct: { id: string; sku: string; name: string } | null
  onSelect: (product: { id: string; sku: string; name: string }) => void
  onClear: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductSearchResult[]>([])
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


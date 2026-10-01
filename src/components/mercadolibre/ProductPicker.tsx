'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Loader2, Search } from 'lucide-react'

export interface ProductLite {
  id: string
  sku: string
  name: string
  stockQuantity: number
}

/** Buscador de productos del ERP por SKU o nombre (autocompletado). */
export function ProductPicker({ onSelect, placeholder = 'SKU o nombre del producto…' }: { onSelect: (p: ProductLite) => void; placeholder?: string }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<ProductLite[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const search = async (text: string) => {
    if (text.trim().length < 2) return setResults([])
    setSearching(true)
    try {
      const res = await fetch(`/api/inventory/search-products?q=${encodeURIComponent(text)}`)
      const data = await res.json()
      setResults(data.products ?? [])
    } finally {
      setSearching(false)
    }
  }

  return (
    <div ref={box} className="relative min-w-[220px]">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={q}
          placeholder={placeholder}
          className="h-8 pl-7 text-xs"
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => search(e.target.value), 300)
          }}
          onFocus={() => setOpen(true)}
        />
        {searching && <Loader2 className="absolute right-2 top-2.5 h-3.5 w-3.5 animate-spin" />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-[360px] overflow-auto rounded-md border bg-popover shadow-md">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="flex w-full flex-col items-start px-3 py-2 text-left text-xs hover:bg-muted"
              onClick={() => {
                onSelect(p)
                setQ('')
                setResults([])
                setOpen(false)
              }}
            >
              <span className="font-mono font-medium">{p.sku}</span>
              <span className="text-muted-foreground">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

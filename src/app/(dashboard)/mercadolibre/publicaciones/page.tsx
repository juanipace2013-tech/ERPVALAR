'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Check, Download, ExternalLink, Loader2, RefreshCw, Search, X } from 'lucide-react'

interface ProductLite {
  id: string
  sku: string
  name: string
  stockQuantity: number
}

interface LinkRow {
  id: string
  mlItemId: string
  title: string
  permalink: string | null
  mlStatus: string | null
  mlSku: string | null
  mlQuantity: number | null
  price: number | null
  productId: string | null
  product: ProductLite | null
  status: 'UNMATCHED' | 'LINKED' | 'IGNORED'
  matchMethod: string | null
  syncEnabled: boolean
  safetyStock: number
  maxPublish: number | null
  lastSyncAt: string | null
  lastSyncQty: number | null
  lastSyncError: string | null
}

const TAB_LABEL: Record<string, string> = {
  UNMATCHED: 'Sin vincular',
  LINKED: 'Vinculadas',
  IGNORED: 'Ignoradas',
  ALL: 'Todas',
}

const ML_STATUS_COLOR: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  closed: 'bg-gray-200 text-gray-700',
}

function target(row: LinkRow): number | null {
  if (!row.product) return null
  let t = Math.max(0, row.product.stockQuantity - row.safetyStock)
  if (row.maxPublish != null) t = Math.min(t, row.maxPublish)
  return t
}

function ProductPicker({ onSelect }: { onSelect: (p: ProductLite) => void }) {
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
          placeholder="SKU o nombre del producto…"
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

export default function PublicacionesMlPage() {
  const [tab, setTab] = useState('UNMATCHED')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<LinkRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/mercadolibre/publicaciones?status=${tab}&q=${encodeURIComponent(q)}`
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error')
      setItems(data.items)
      setCounts(data.counts ?? {})
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [tab, q])

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  const patch = async (row: LinkRow, body: Record<string, unknown>) => {
    setBusy(row.id)
    try {
      const res = await fetch(`/api/mercadolibre/publicaciones/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error')
      const updated = data as LinkRow & { skuPushed?: boolean | null }
      if (updated.skuPushed === false) toast.warning('Vinculada, pero no se pudo escribir el SKU en ML')
      setItems((prev) =>
        tab === 'ALL' || updated.status === tab
          ? prev.map((x) => (x.id === updated.id ? updated : x))
          : prev.filter((x) => x.id !== updated.id)
      )
      setCounts((c) => {
        const n = { ...c }
        if (row.status !== updated.status) {
          n[row.status] = Math.max(0, (n[row.status] ?? 1) - 1)
          n[updated.status] = (n[updated.status] ?? 0) + 1
        }
        return n
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setBusy(null)
    }
  }

  const importListings = async () => {
    setImporting(true)
    try {
      const res = await fetch('/api/mercadolibre/publicaciones/import', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error')
      toast.success(
        `${data.total} publicaciones · ${data.linked} vinculadas · ${data.unmatched} sin vincular`
      )
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al importar')
    } finally {
      setImporting(false)
    }
  }

  const syncStock = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/mercadolibre/publicaciones/sync-stock', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error')
      toast.success(
        `Stock: ${data.updated} actualizadas, ${data.unchanged} sin cambios, ${data.errors} errores (Colppy→ERP: ${data.colppy.updated} act.)`
      )
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al sincronizar')
    } finally {
      setSyncing(false)
    }
  }

  const exportCsv = () => {
    const rows = items.map((r) =>
      [r.mlItemId, r.title, r.mlSku ?? '', r.mlQuantity ?? '', r.permalink ?? '']
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(';')
    )
    const csv = ['ML ID;Título;SKU en ML;Cantidad ML;Link', ...rows].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `publicaciones-ml-${tab.toLowerCase()}.csv`
    a.click()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Publicaciones de Mercado Libre</h1>
          <p className="text-sm text-muted-foreground">
            Vinculá cada publicación con su producto del ERP. El stock se sincroniza cada hora:
            Colppy → ERP → ML (se publica <i>stock − seguridad</i>, con tope opcional).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={items.length === 0}>
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" onClick={importListings} disabled={importing}>
            {importing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Importar publicaciones
          </Button>
          <Button onClick={syncStock} disabled={syncing}>
            {syncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sincronizar stock ahora
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            {['UNMATCHED', 'LINKED', 'IGNORED', 'ALL'].map((s) => (
              <TabsTrigger key={s} value={s}>
                {TAB_LABEL[s]}
                {s !== 'ALL' && counts[s] != null && (
                  <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px]">{counts[s]}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por título, MLA o SKU"
            className="w-72 pl-8"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {counts.LINKED == null && counts.UNMATCHED == null
              ? 'Todavía no se importaron publicaciones. Tocá "Importar publicaciones".'
              : 'Sin resultados.'}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Publicación</TableHead>
                <TableHead className="text-right">Stock ML</TableHead>
                <TableHead>Producto ERP</TableHead>
                <TableHead className="text-right">Stock ERP</TableHead>
                <TableHead className="text-right">Seguridad</TableHead>
                <TableHead className="text-right">Tope</TableHead>
                <TableHead className="text-right">A publicar</TableHead>
                <TableHead>Sync</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => {
                const t = target(row)
                const diff = t != null && row.mlQuantity != null && t !== row.mlQuantity
                return (
                  <TableRow key={row.id} className={busy === row.id ? 'opacity-60' : ''}>
                    <TableCell className="max-w-[360px]">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium" title={row.title}>
                            {row.title}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <a
                              href={row.permalink ?? '#'}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 hover:underline"
                            >
                              {row.mlItemId} <ExternalLink className="h-3 w-3" />
                            </a>
                            {row.mlStatus && (
                              <Badge className={`${ML_STATUS_COLOR[row.mlStatus] ?? ''} text-[10px]`}>
                                {row.mlStatus}
                              </Badge>
                            )}
                            {row.mlSku && <span>SKU ML: {row.mlSku}</span>}
                            {row.matchMethod && row.status === 'LINKED' && (
                              <span className="text-[10px]">({row.matchMethod})</span>
                            )}
                          </div>
                          {row.lastSyncError && (
                            <div className="mt-1 truncate text-xs text-red-600" title={row.lastSyncError}>
                              {row.lastSyncError}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.mlQuantity ?? '—'}</TableCell>
                    <TableCell>
                      {row.product ? (
                        <div className="flex items-center gap-1 rounded border border-green-200 bg-green-50 px-2 py-1">
                          <Check className="h-3 w-3 shrink-0 text-green-600" />
                          <span className="font-mono text-xs text-green-800">{row.product.sku}</span>
                          <span className="truncate text-xs text-green-700" title={row.product.name}>
                            {row.product.name.slice(0, 28)}
                          </span>
                          <button
                            className="ml-auto text-green-600 hover:text-red-500"
                            title="Desvincular"
                            onClick={() => patch(row, { productId: null })}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : row.status === 'IGNORED' ? (
                        <span className="text-xs text-muted-foreground">ignorada</span>
                      ) : (
                        <ProductPicker onSelect={(p) => patch(row, { productId: p.id })} />
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.product ? row.product.stockQuantity : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.product && (
                        <Input
                          type="number"
                          min={0}
                          defaultValue={row.safetyStock}
                          className="h-8 w-16 text-right text-xs"
                          onBlur={(e) => {
                            const v = Number(e.target.value)
                            if (v !== row.safetyStock) patch(row, { safetyStock: v })
                          }}
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.product && (
                        <Input
                          type="number"
                          min={0}
                          placeholder="∞"
                          defaultValue={row.maxPublish ?? ''}
                          className="h-8 w-16 text-right text-xs"
                          onBlur={(e) => {
                            const raw = e.target.value
                            const v = raw === '' ? null : Number(raw)
                            if (v !== row.maxPublish) patch(row, { maxPublish: v })
                          }}
                        />
                      )}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${diff ? 'font-semibold text-amber-700' : ''}`}>
                      {t ?? '—'}
                    </TableCell>
                    <TableCell>
                      {row.product && (
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={row.syncEnabled}
                            onChange={(e) => patch(row, { syncEnabled: e.target.checked })}
                          />
                          {row.syncEnabled ? 'sí' : 'no'}
                        </label>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.status === 'IGNORED' ? (
                        <Button size="sm" variant="ghost" onClick={() => patch(row, { ignore: false })}>
                          Restaurar
                        </Button>
                      ) : (
                        row.status === 'UNMATCHED' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground"
                            onClick={() => patch(row, { ignore: true })}
                          >
                            Ignorar
                          </Button>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

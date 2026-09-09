'use client'

/**
 * Stock en vivo del proveedor FAMIQ para productos marca FMQ: consulta
 * /api/famiq/stock y muestra las sucursales con stock y el precio de lista
 * general de la web. Se renderiza solo si el producto tiene mapeo (linked).
 */

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'

interface FamiqStockData {
  linked: boolean
  stockTotal?: number
  sucursales?: { nombre: string; stock: number }[]
  precioListaUsd?: number | null
  fetchedAt?: string
  url?: string
  error?: string
}

export function FamiqStock({ sku }: { sku: string }) {
  const [data, setData] = useState<FamiqStockData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/famiq/stock?sku=${encodeURIComponent(sku)}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setData(d) })
      .catch(() => { if (alive) setData(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [sku])

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-400">
        <Loader2 className="h-3 w-3 animate-spin" /> FAMIQ...
      </span>
    )
  }
  if (!data?.linked) return null

  const conStock = data.sucursales ?? []
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <a
        href={data.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-gray-500 hover:underline"
        title={data.fetchedAt ? `Consultado ${new Date(data.fetchedAt).toLocaleTimeString('es-AR')}` : undefined}
      >
        Stock FAMIQ:
      </a>
      {conStock.length === 0 ? (
        <Badge variant="outline" className="text-red-600 border-red-200">sin stock</Badge>
      ) : (
        conStock.map((s) => (
          <Badge key={s.nombre} variant="outline" className="text-green-700 border-green-200">
            {s.nombre} {s.stock}
          </Badge>
        ))
      )}
      {data.precioListaUsd != null && (
        <span className="text-gray-400">· lista USD {data.precioListaUsd.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
      )}
    </span>
  )
}

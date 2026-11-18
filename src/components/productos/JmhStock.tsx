'use client'

/**
 * Stock en vivo del proveedor JMH para productos marca CENI/JMH: consulta
 * /api/jmh/stock y muestra la cantidad disponible y el precio de lista general
 * de su tienda. Se renderiza solo si el producto tiene mapeo (linked).
 */

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'

interface JmhStockData {
  linked: boolean
  stock?: number | null
  aPedido?: boolean
  precioListaUsd?: number | null
  fetchedAt?: string
  url?: string
  error?: string
}

/** Marcas del ERP que salen de la tienda de JMH */
export function esMarcaJmh(brand: string | null | undefined): boolean {
  const b = brand?.trim().toUpperCase()
  return b === 'CENI' || b === 'JMH'
}

export function JmhStock({ sku }: { sku: string }) {
  // se guarda junto al sku consultado: al cambiar de producto vuelve a "cargando"
  const [res, setRes] = useState<{ sku: string; data: JmhStockData | null } | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/jmh/stock?sku=${encodeURIComponent(sku)}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setRes({ sku, data: d }) })
      .catch(() => { if (alive) setRes({ sku, data: null }) })
    return () => { alive = false }
  }, [sku])

  const loading = res?.sku !== sku
  const data = loading ? null : res.data

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-400">
        <Loader2 className="h-3 w-3 animate-spin" /> JMH...
      </span>
    )
  }
  if (!data?.linked) return null

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <a
        href={data.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-gray-500 hover:underline"
        title={data.fetchedAt ? `Consultado ${new Date(data.fetchedAt).toLocaleTimeString('es-AR')}` : undefined}
      >
        Stock JMH:
      </a>
      {data.error ? (
        // no confundir "no pude consultar" con "no hay"
        <Badge variant="outline" className="text-amber-700 border-amber-200">no se pudo consultar</Badge>
      ) : data.stock == null ? (
        <Badge variant="outline" className="text-gray-600 border-gray-200" title="La tienda de JMH no publica stock de este artículo">
          no informa
        </Badge>
      ) : data.stock > 0 ? (
        <Badge variant="outline" className="text-green-700 border-green-200">
          {data.stock.toLocaleString('es-AR')}
        </Badge>
      ) : (
        <Badge variant="outline" className="text-red-600 border-red-200">
          {data.aPedido ? 'sin stock · consultar plazo' : 'sin stock'}
        </Badge>
      )}
      {data.precioListaUsd != null && (
        <span className="text-gray-400">· lista USD {data.precioListaUsd.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
      )}
    </span>
  )
}

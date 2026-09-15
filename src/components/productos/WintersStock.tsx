'use client'

/**
 * Stock local de WINTERS (Buenos Aires) para productos marca WINTERS, según la
 * última planilla "Stock WINAR" que importó el cron ingest-stock-winters desde
 * el mail semanal. La planilla trae solo lo disponible: si el código no figura
 * se muestra "sin stock". No se renderiza hasta que haya al menos un import.
 */

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'

interface WintersStockData {
  imported: boolean
  cantidad?: number
  fechaLista?: string
  error?: string
}

export function WintersStock({ sku }: { sku: string }) {
  const [data, setData] = useState<WintersStockData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/winters/stock?sku=${encodeURIComponent(sku)}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setData(d) })
      .catch(() => { if (alive) setData(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [sku])

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-400">
        <Loader2 className="h-3 w-3 animate-spin" /> Winters...
      </span>
    )
  }
  if (!data?.imported) return null

  const fecha = data.fechaLista
    ? new Date(data.fechaLista).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
    : null

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span className="font-medium text-gray-500" title={fecha ? `Planilla Stock WINAR al ${fecha}` : undefined}>
        Stock Winters:
      </span>
      {!data.cantidad ? (
        <Badge variant="outline" className="text-red-600 border-red-200">sin stock</Badge>
      ) : (
        <Badge variant="outline" className="text-green-700 border-green-200">BA {data.cantidad}</Badge>
      )}
      {fecha && <span className="text-gray-400">· lista al {fecha}</span>}
    </span>
  )
}

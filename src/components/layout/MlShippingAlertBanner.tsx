'use client'

/**
 * Cartel rojo global: ventas de ML con envío a provincia bloqueada (Misiones).
 * No despachamos ahí, así que la venta hay que anularla en ML. Se muestra en
 * todas las páginas del dashboard mientras haya alertas PENDING; "Resuelta" la
 * saca (POST /resolver). Poll cada 60 s + refetch al navegar.
 */

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { AlertOctagon, ExternalLink } from 'lucide-react'

interface ShippingAlert {
  id: string
  orderId: string
  stateName: string
  city: string | null
  buyerName: string | null
  itemsSummary: string | null
}

const POLL_MS = 60_000

export function MlShippingAlertBanner() {
  const pathname = usePathname()
  const [alerts, setAlerts] = useState<ShippingAlert[]>([])
  const [resolving, setResolving] = useState<string | null>(null)

  const refetch = useCallback(() => {
    fetch('/api/mercadolibre/alertas-envio')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.items)) setAlerts(data.items)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    refetch()
    const timer = setInterval(refetch, POLL_MS)
    return () => clearInterval(timer)
  }, [refetch, pathname])

  const resolver = async (id: string) => {
    setResolving(id)
    try {
      const res = await fetch(`/api/mercadolibre/alertas-envio/${id}/resolver`, {
        method: 'POST',
      })
      if (res.ok) setAlerts((prev) => prev.filter((a) => a.id !== id))
    } finally {
      setResolving(null)
    }
  }

  if (alerts.length === 0) return null

  return (
    <div className="border-b border-red-700 bg-red-600 text-white">
      {alerts.map((a) => (
        <div
          key={a.id}
          className="mx-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
        >
          <AlertOctagon className="h-5 w-5 shrink-0" />
          <span className="font-semibold">
            Venta ML #{a.orderId} con envío a {a.stateName}
            {a.city ? ` (${a.city})` : ''} — NO despachamos a {a.stateName}: anular la venta.
          </span>
          <span className="hidden truncate text-red-100 md:inline">
            {a.buyerName ? `${a.buyerName} · ` : ''}
            {a.itemsSummary ?? ''}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <a
              href={`https://www.mercadolibre.com.ar/ventas/${a.orderId}/detalle`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded bg-white px-2.5 py-1 font-medium text-red-700 hover:bg-red-50"
            >
              Ver en ML
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <button
              onClick={() => resolver(a.id)}
              disabled={resolving === a.id}
              className="rounded border border-white/60 px-2.5 py-1 font-medium hover:bg-red-700 disabled:opacity-60"
            >
              {resolving === a.id ? 'Guardando…' : 'Marcar resuelta'}
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}

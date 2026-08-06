'use client'

import { useEffect, useState } from 'react'

/**
 * TC USD→ARS vigente de la tabla ExchangeRate del ERP.
 * Para conversiones informativas (ej: deuda BCRA aproximada en USD).
 * Devuelve null mientras carga o si no hay TC cargado.
 */
export function useTipoCambioUsd(): number | null {
  const [tc, setTc] = useState<number | null>(null)

  useEffect(() => {
    let cancelado = false
    fetch('/api/tipo-cambio?from=USD&to=ARS')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelado || !j) return
        const rate = Number(j.rates?.[0]?.rate)
        if (rate > 0) setTc(rate)
      })
      .catch(() => {
        // sin TC: las vistas simplemente no muestran el equivalente USD
      })
    return () => {
      cancelado = true
    }
  }, [])

  return tc
}

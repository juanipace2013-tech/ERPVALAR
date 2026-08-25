'use client'

/**
 * Tracker invisible de actividad del dashboard. Montado en el layout:
 *   - En cada cambio de ruta manda un beacon {type:"nav"} a /api/track
 *     (deduplicado: la misma ruta repetida dentro de 30 s no se re-manda).
 *   - Cada 2 minutos, solo si la pestaña está visible, manda un heartbeat
 *     que mantiene fresca la presencia (lastSeenAt/lastPath).
 *
 * Usa navigator.sendBeacon para no bloquear la navegación (con fallback a
 * fetch keepalive). Si el tracking falla, no pasa nada visible.
 */

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

const HEARTBEAT_MS = 2 * 60 * 1000
const NAV_DEDUPE_MS = 30 * 1000

function send(type: 'nav' | 'heartbeat', path: string) {
  try {
    const payload = JSON.stringify({ type, path })
    const blob = new Blob([payload], { type: 'application/json' })
    if (!navigator.sendBeacon?.('/api/track', blob)) {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {})
    }
  } catch {
    // nunca molestar al usuario por el tracking
  }
}

export function ActivityTracker() {
  const pathname = usePathname()
  const lastNav = useRef<{ path: string; at: number }>({ path: '', at: 0 })

  // Navegación
  useEffect(() => {
    if (!pathname) return
    const now = Date.now()
    const { path, at } = lastNav.current
    if (path === pathname && now - at < NAV_DEDUPE_MS) return
    lastNav.current = { path: pathname, at: now }
    send('nav', pathname)
  }, [pathname])

  // Heartbeat de presencia
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') {
        send('heartbeat', window.location.pathname)
      }
    }
    const id = setInterval(tick, HEARTBEAT_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  return null
}

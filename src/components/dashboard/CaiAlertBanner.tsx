'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, X } from 'lucide-react'

export function CaiAlertBanner() {
  const [warnings, setWarnings] = useState<string[]>([])
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    fetch('/api/cai-config/active')
      .then((res) => res.json())
      .then((data) => {
        if (data.warnings && data.warnings.length > 0) {
          setWarnings(data.warnings)
        }
      })
      .catch(() => {})
  }, [])

  if (dismissed || warnings.length === 0) return null

  const isError = warnings.some(
    (w) => w.includes('vencido') || w.includes('agotó')
  )

  return (
    <div
      className={`rounded-lg border p-4 flex items-start gap-3 ${
        isError
          ? 'bg-red-50 border-red-200 text-red-800'
          : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}
    >
      <AlertTriangle className={`h-5 w-5 flex-shrink-0 mt-0.5 ${isError ? 'text-red-500' : 'text-amber-500'}`} />
      <div className="flex-1">
        <p className="font-semibold text-sm">
          {isError ? 'Atención: CAI con problemas' : 'Aviso: CAI próximo a vencer'}
        </p>
        <ul className="text-sm mt-1 space-y-0.5">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
        <Link
          href="/configuracion"
          className="text-sm underline mt-1 inline-block"
        >
          Ir a Configuración de CAI
        </Link>
      </div>
      <button onClick={() => setDismissed(true)} className="flex-shrink-0">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

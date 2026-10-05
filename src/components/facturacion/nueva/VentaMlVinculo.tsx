'use client'

/**
 * Venta de Mercado Libre vinculada a la factura directa (opcional, solo en
 * pesos): para ventas viejas o casos raros. Muestra el comprador, el total, si
 * está paga, si ML ya tiene una factura y si el ERP ya la facturó, y permite
 * precargar las líneas. Es informativo: al emitir el servidor verifica todo de
 * nuevo y toma el candado de la venta.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ListPlus, Loader2, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'
import type { InspeccionVentaMl } from '@/lib/mercadolibre/venta-ml-vinculo'
import { bloqueosVentaMl } from '@/lib/facturacion/factura-directa-ui'

export function VentaMlVinculo({
  mlVenta,
  onMlVenta,
  moneda,
  onPrecargar,
  buscarAlInicio = false,
  disabled = false,
}: {
  mlVenta: string
  onMlVenta: (v: string) => void
  moneda: 'ARS' | 'USD'
  onPrecargar: (v: InspeccionVentaMl) => void
  /** Deep link ?mlVenta=: buscar la venta apenas se monta */
  buscarAlInicio?: boolean
  disabled?: boolean
}) {
  const [venta, setVenta] = useState<InspeccionVentaMl | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inicial = useRef(buscarAlInicio)

  const id = mlVenta.replace(/\s/g, '')

  const buscar = useCallback(async (numero: string) => {
    if (!/^\d{1,20}$/.test(numero)) {
      setError('El número de la venta tiene que ser solo dígitos (pack u orden)')
      return
    }
    setBuscando(true)
    setError(null)
    setVenta(null)
    try {
      const r = await fetch(`/api/facturas/directa/venta-ml/${numero}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`)
      const v = d as InspeccionVentaMl
      setVenta(v)
      // Una orden de un pack se vincula con la clave del pack
      if (v.packId !== numero) onMlVenta(v.packId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBuscando(false)
    }
  }, [onMlVenta])

  useEffect(() => {
    if (inicial.current && id) {
      inicial.current = false
      buscar(id)
    }
  }, [id, buscar])

  // Si se cambia el número, lo que se mostraba ya no corresponde
  const vigente = venta && venta.packId === id ? venta : null
  const bloqueos = vigente ? bloqueosVentaMl(vigente) : []

  if (moneda !== 'ARS') {
    return (
      <p className="text-sm text-muted-foreground">
        Una venta de Mercado Libre solo se vincula a una factura en pesos.
        {id && <span className="ml-1 text-red-600">Pasá la factura a pesos o quitá la venta ({id}).</span>}
        {id && (
          <Button type="button" variant="link" size="sm" className="h-auto p-0 pl-1" onClick={() => onMlVenta('')} disabled={disabled}>
            Quitar
          </Button>
        )}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={mlVenta}
          onChange={(e) => {
            onMlVenta(e.target.value.replace(/[^\d]/g, ''))
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              buscar(id)
            }
          }}
          placeholder="N° de venta (pack u orden) — opcional"
          inputMode="numeric"
          className="sm:max-w-xs"
          disabled={disabled}
        />
        <Button type="button" variant="outline" onClick={() => buscar(id)} disabled={disabled || buscando || !id}>
          {buscando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
          Buscar
        </Button>
        {id && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onMlVenta('')
              setVenta(null)
              setError(null)
            }}
            disabled={disabled}
          >
            <X className="mr-1 h-4 w-4" />
            Quitar
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {id && !vigente && !buscando && !error && <p className="text-xs text-muted-foreground">Buscá la venta para ver sus datos (al emitir se verifica igual).</p>}

      {vigente && (
        <div className="space-y-2 rounded-md border bg-gray-50 p-3 text-sm dark:bg-gray-900">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Venta #{vigente.packId}</span>
            {vigente.orderIds.length > 1 && <span className="text-xs text-muted-foreground">{vigente.orderIds.length} órdenes</span>}
            {vigente.fecha && <span className="text-xs text-muted-foreground">{new Date(vigente.fecha).toLocaleDateString('es-AR')}</span>}
            {vigente.pagada ? (
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Pagada</Badge>
            ) : (
              <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Sin pagar</Badge>
            )}
            {vigente.facturaEnMl === true && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Ya tiene factura en ML</Badge>}
            {vigente.facturaEnMl === null && !vigente.yaFacturada && <Badge variant="outline">ML no confirmó si tiene factura</Badge>}
            {vigente.anteriorAlCorte && <Badge variant="outline">Anterior al corte (probablemente la facturó Colppy)</Badge>}
          </div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            <span>
              Comprador: <b>{vigente.nombreMl ?? vigente.buyerNickname ?? '—'}</b>
              {vigente.nombreMl && vigente.buyerNickname ? <span className="text-muted-foreground"> ({vigente.buyerNickname})</span> : null}
            </span>
            <span>
              Documento según ML: <b>{vigente.documentoMl ? `${vigente.documentoMl.tipo} ${vigente.documentoMl.numero}` : '—'}</b>
              {vigente.fiscalError && <span className="text-xs text-muted-foreground"> · {vigente.fiscalError}</span>}
            </span>
            <span>
              Total cobrado: <b>{formatCurrency(vigente.totalMl, 'ARS')}</b>
            </span>
            <span>{vigente.lineas.length} {vigente.lineas.length === 1 ? 'artículo' : 'artículos'}</span>
          </div>
          {bloqueos.length > 0 && (
            <ul className="space-y-1 text-red-700">
              {bloqueos.map((b) => (
                <li key={b} className="flex items-start gap-1">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {b}
                </li>
              ))}
            </ul>
          )}
          {!bloqueos.length && (
            <p className="flex items-center gap-1 text-xs text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Se puede vincular: al emitir, la factura se sube a la venta en ML
            </p>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => onPrecargar(vigente)} disabled={disabled || !vigente.lineas.length}>
            <ListPlus className="mr-2 h-4 w-4" />
            Precargar líneas de la venta
          </Button>
        </div>
      )}
    </div>
  )
}

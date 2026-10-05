'use client'

/**
 * Líneas de la factura directa: producto del ERP (ProductPicker) o texto
 * libre, cantidad, precio unitario (neto o final con IVA según la letra y el
 * switch), IVA 21% fijo y subtotal. Un producto con IVA distinto de 21% se
 * rechaza (v1). Los números se tipean en formato argentino (1.234,56).
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn, formatCurrency } from '@/lib/utils'
import { ProductPicker } from '@/components/mercadolibre/ProductPicker'
import { parseNumeroAr } from '@/lib/facturacion/nc-unidades'
import { MAX_LINEAS_FACTURA_DIRECTA, type MonedaFacturaDirecta, type ProblemaFacturaDirecta } from '@/lib/facturacion/factura-directa-form'
import {
  erroresDeLinea,
  lineaConProducto,
  lineaEnBlanco,
  lineaVacia,
  numeroATexto,
  precioVentaSugerido,
  type LineaFormFacturaDirecta,
  type PrecioProducto,
} from '@/lib/facturacion/factura-directa-ui'

export function LineasFacturaEditor({
  lineas,
  onChange,
  preciosFinales,
  moneda,
  errores,
  mostrarErroresEnBlanco,
  nuevoUid,
  disabled = false,
}: {
  lineas: LineaFormFacturaDirecta[]
  onChange: (lineas: LineaFormFacturaDirecta[]) => void
  /** true = el precio tipeado es final con IVA (B, o A con "precios con IVA") */
  preciosFinales: boolean
  moneda: MonedaFacturaDirecta
  /** Errores de la validación (con `linea` = fila 1..n) */
  errores: ProblemaFacturaDirecta[]
  /** Después de pedir la vista previa, también se marcan las filas vacías */
  mostrarErroresEnBlanco: boolean
  nuevoUid: () => string
  disabled?: boolean
}) {
  // Precios del ERP de los productos elegidos (para sugerir el de venta)
  const [preciosPorFila, setPreciosPorFila] = useState<Record<string, PrecioProducto[]>>({})

  const setFila = (i: number, patch: Partial<LineaFormFacturaDirecta>) => onChange(lineas.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const quitar = (i: number) => {
    const resto = lineas.filter((_, j) => j !== i)
    onChange(resto.length ? resto : [lineaVacia(nuevoUid())])
  }
  const agregar = () => onChange([...lineas, lineaVacia(nuevoUid())])

  const etiquetaPrecio = preciosFinales ? 'Precio final (IVA incl.)' : 'Precio neto (sin IVA)'

  return (
    <div className="space-y-3">
      {lineas.map((l, i) => {
        const cantidad = parseNumeroAr(l.cantidad)
        const precio = parseNumeroAr(l.precio)
        const subtotal = Number.isFinite(cantidad) && Number.isFinite(precio) ? Math.round(cantidad * precio * 100) / 100 : null
        const errs = lineaEnBlanco(l) && !mostrarErroresEnBlanco ? [] : erroresDeLinea(errores, i)
        const sugerido = l.productId ? precioVentaSugerido(preciosPorFila[l.uid], moneda, preciosFinales) : null
        return (
          <div key={l.uid} className={cn('rounded-lg border bg-white p-3 dark:bg-gray-900', errs.length && 'border-red-300')}>
            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-12 flex items-center gap-2 md:col-span-4">
                <span className="w-6 shrink-0 text-xs font-semibold text-muted-foreground">{i + 1}</span>
                {l.productId ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    <Badge variant="outline" className="max-w-full truncate font-mono" title="Producto del ERP">
                      {l.sku || 'Producto'}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setFila(i, { productId: null, sku: null })}
                      disabled={disabled}
                      title="Quitar el producto (queda como texto libre)"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : disabled ? (
                  <span className="text-xs text-muted-foreground">Texto libre</span>
                ) : (
                  <div className="min-w-0 flex-1">
                    <ProductPicker
                      placeholder="Producto (SKU o nombre) o texto libre →"
                      onSelect={(p) => {
                        const r = lineaConProducto(l, p)
                        if (!r.linea) {
                          toast.error('Producto no admitido', { description: r.error, duration: 10000 })
                          return
                        }
                        setPreciosPorFila((m) => ({ ...m, [l.uid]: p.prices ?? [] }))
                        setFila(i, r.linea)
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="col-span-12 md:col-span-8">
                <Input
                  value={l.descripcion}
                  onChange={(e) => setFila(i, { descripcion: e.target.value })}
                  placeholder="Descripción"
                  maxLength={200}
                  className="h-8 text-sm"
                  disabled={disabled}
                  aria-label={`Descripción de la línea ${i + 1}`}
                />
              </div>

              <div className="col-span-4 md:col-span-2">
                <label className="text-[11px] text-muted-foreground">Cantidad</label>
                <Input
                  value={l.cantidad}
                  onChange={(e) => setFila(i, { cantidad: e.target.value })}
                  inputMode="decimal"
                  className="h-8 text-right text-sm"
                  disabled={disabled}
                />
              </div>
              <div className="col-span-8 md:col-span-3">
                <label className="text-[11px] text-muted-foreground">
                  {etiquetaPrecio} ({moneda})
                </label>
                <Input
                  value={l.precio}
                  onChange={(e) => setFila(i, { precio: e.target.value })}
                  inputMode="decimal"
                  placeholder="0,00"
                  className="h-8 text-right text-sm"
                  disabled={disabled}
                />
                {sugerido && parseNumeroAr(l.precio) !== sugerido.precio && !disabled && (
                  <button
                    type="button"
                    className="mt-0.5 text-[11px] text-blue-600 hover:underline"
                    onClick={() => setFila(i, { precio: numeroATexto(sugerido.precio) })}
                    title={`Precio de venta del ERP: ${formatCurrency(sugerido.neto, moneda)} + IVA`}
                  >
                    Usar precio de venta del ERP: {formatCurrency(sugerido.precio, moneda)}
                    {preciosFinales ? ' (con IVA)' : ''}
                  </button>
                )}
              </div>
              <div className="col-span-4 md:col-span-1">
                <label className="text-[11px] text-muted-foreground">IVA</label>
                <div className="flex h-8 items-center text-sm">21%</div>
              </div>
              <div className="col-span-6 md:col-span-2">
                <label className="text-[11px] text-muted-foreground">Subtotal {preciosFinales ? 'final' : 'neto'}</label>
                <div className="flex h-8 items-center justify-end font-mono text-sm">{subtotal !== null ? formatCurrency(subtotal, moneda) : '—'}</div>
              </div>
              <div className="col-span-10 md:col-span-3">
                <label className="text-[11px] text-muted-foreground">Comentario (opcional, sale debajo)</label>
                <Input
                  value={l.comentario}
                  onChange={(e) => setFila(i, { comentario: e.target.value })}
                  placeholder="Ej.: ítem 3 de la OC"
                  maxLength={200}
                  className="h-8 text-sm"
                  disabled={disabled}
                />
              </div>
              <div className="col-span-2 flex items-end justify-end md:col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => quitar(i)}
                  disabled={disabled}
                  title="Borrar la línea"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {errs.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-red-600">
                {errs.map((e, k) => (
                  <li key={k}>{e.mensaje}</li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={agregar} disabled={disabled || lineas.length >= MAX_LINEAS_FACTURA_DIRECTA}>
          <Plus className="mr-2 h-4 w-4" />
          Agregar línea
        </Button>
        <span className="text-xs text-muted-foreground">
          {lineas.length} de {MAX_LINEAS_FACTURA_DIRECTA} líneas · IVA 21% en todas (por ahora no se emiten otras alícuotas)
        </span>
      </div>
    </div>
  )
}

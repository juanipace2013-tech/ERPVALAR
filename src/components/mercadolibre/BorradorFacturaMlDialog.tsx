'use client'

/**
 * Borrador de la factura de una venta de Mercado Libre: datos del cliente
 * (padrón ARCA) + líneas editables (producto, descripción, cantidad, precio
 * final con IVA). Nada se emite hasta que el usuario confirma.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AlertTriangle, Loader2, Plus, Search, Trash2, X } from 'lucide-react'
import { ProductPicker } from './ProductPicker'

export interface VentaParaBorrador {
  packId: string
  total: number
  cuit: string | null
  buyerNickname: string | null
  items: Array<{
    title: string
    quantity: number
    unitPrice: number
    productId: string | null
    sku: string | null
    productName: string | null
  }>
}

interface Linea {
  productId: string | null
  sku: string | null
  descripcion: string
  cantidad: string
  precioFinal: string
}

interface ClienteArca {
  name: string
  taxCondition?: string
  address?: string
  city?: string
  province?: string
  status?: string
}

const ars = (n: number) => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })
const num = (s: string) => Number(String(s).replace(',', '.'))
const redondear = (n: number) => Math.round(n * 100) / 100

export function BorradorFacturaMlDialog({
  venta,
  onClose,
  onEmitida,
}: {
  venta: VentaParaBorrador | null
  onClose: () => void
  onEmitida: () => void
}) {
  const [cuit, setCuit] = useState('')
  const [cliente, setCliente] = useState<ClienteArca | null>(null)
  const [clienteError, setClienteError] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [lineas, setLineas] = useState<Linea[]>([])
  const [emitiendo, setEmitiendo] = useState(false)

  const buscarCliente = async (c: string) => {
    const digits = c.replace(/\D/g, '')
    setCliente(null)
    setClienteError(null)
    if (digits.length !== 11) return
    setBuscando(true)
    try {
      const res = await fetch(`/api/afip/cuit/${digits}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.message || json.error || 'No se encontró el CUIT en ARCA')
      setCliente(json.data)
    } catch (e) {
      setClienteError((e as Error).message)
    } finally {
      setBuscando(false)
    }
  }

  // Al abrir: pre-cargar CUIT (si ML lo informó) y las líneas de la orden
  useEffect(() => {
    if (!venta) return
    setCuit(venta.cuit ?? '')
    setLineas(
      venta.items.map((it) => ({
        productId: it.productId,
        sku: it.sku,
        descripcion: it.productName ?? it.title,
        cantidad: String(it.quantity),
        precioFinal: String(it.unitPrice),
      }))
    )
    setCliente(null)
    setClienteError(null)
    if (venta.cuit) buscarCliente(venta.cuit)
  }, [venta])

  const setLinea = (i: number, patch: Partial<Linea>) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  const totalFinal = redondear(lineas.reduce((s, l) => s + (num(l.cantidad) || 0) * (num(l.precioFinal) || 0), 0))
  const neto = redondear(totalFinal / 1.21)
  const iva = redondear(totalFinal - neto)
  const difiere = venta ? Math.abs(totalFinal - venta.total) >= 1 : false
  const esRI = cliente?.taxCondition === 'RESPONSABLE_INSCRIPTO'
  const lineasOk = lineas.length > 0 && lineas.every((l) => l.descripcion.trim() && num(l.cantidad) > 0 && num(l.precioFinal) > 0)

  const emitir = async () => {
    if (!venta) return
    const ok = window.confirm(
      `¿Emitir Factura A por ${ars(totalFinal)} a ${cliente?.name} (${cuit})?\n\nSale por el punto de venta 0007 (ARCA), se registra en Colppy y se sube a la venta de Mercado Libre. No se puede deshacer (solo con nota de crédito).`
    )
    if (!ok) return
    setEmitiendo(true)
    try {
      const res = await fetch('/api/mercadolibre/facturacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packId: venta.packId,
          cuit,
          lineas: lineas.map((l) => ({
            productId: l.productId,
            descripcion: l.descripcion.trim(),
            cantidad: num(l.cantidad),
            precioFinal: num(l.precioFinal),
          })),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error al facturar')
      toast.success(`Factura ${json.invoiceNumber} emitida (CAE ${json.cae})`)
      if (json.colppyPendiente) toast.warning('No se pudo registrar en Colppy: reintentalo desde la factura')
      if (json.colppyBorradorFce)
        toast.warning('Salió como Factura de Crédito MiPyME: en Colppy quedó como BORRADOR. Tildá "Factura de crédito electrónica MiPyME (FCE)" y aprobala.', { duration: 20000 })
      if (!json.mlUpload?.ok) toast.warning(`La factura no se pudo subir a Mercado Libre: ${json.mlUpload?.error ?? ''}`)
      onEmitida()
    } catch (e) {
      toast.error((e as Error).message, { duration: 10000 })
    } finally {
      setEmitiendo(false)
    }
  }

  return (
    <Dialog open={!!venta} onOpenChange={(o) => !o && !emitiendo && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Borrador de factura — venta ML #{venta?.packId}</DialogTitle>
          <DialogDescription>
            Revisá y corregí los datos. No se emite nada hasta que confirmes. Factura A, punto de venta 0007.
          </DialogDescription>
        </DialogHeader>

        {/* Cliente */}
        <div className="rounded-md border p-3">
          <div className="mb-2 text-sm font-semibold">Cliente</div>
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex items-center gap-2">
              <Input
                value={cuit}
                placeholder="CUIT"
                className="h-9 w-44 font-mono"
                onChange={(e) => {
                  setCuit(e.target.value)
                  setCliente(null)
                  setClienteError(null)
                }}
                onKeyDown={(e) => e.key === 'Enter' && buscarCliente(cuit)}
              />
              <Button size="sm" variant="outline" onClick={() => buscarCliente(cuit)} disabled={buscando}>
                {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                <span className="ml-1">AFIP</span>
              </Button>
            </div>
            <div className="min-w-[280px] flex-1 text-sm">
              {cliente ? (
                <>
                  <div className="font-medium">{cliente.name}</div>
                  <div className="text-muted-foreground">
                    {[cliente.address, cliente.city, cliente.province].filter(Boolean).join(', ')}
                  </div>
                  {esRI ? (
                    <Badge className="mt-1 bg-green-100 text-green-800">IVA Responsable Inscripto</Badge>
                  ) : (
                    <Badge variant="destructive" className="mt-1">
                      {cliente.taxCondition ?? 'Sin condición de IVA'}: no es Responsable Inscripto, facturar por Colppy
                    </Badge>
                  )}
                </>
              ) : clienteError ? (
                <span className="text-red-600">{clienteError}</span>
              ) : (
                <span className="text-muted-foreground">
                  {venta?.buyerNickname ? `Comprador ML: ${venta.buyerNickname}. ` : ''}
                  Cargá el CUIT y buscalo en AFIP.
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Líneas */}
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="p-2 text-left">Producto (ERP)</th>
                <th className="p-2 text-left">Descripción en la factura</th>
                <th className="w-20 p-2 text-right">Cant.</th>
                <th className="w-32 p-2 text-right">P. unit. final</th>
                <th className="w-28 p-2 text-right">Subtotal</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i} className="border-t align-top">
                  <td className="w-64 p-2">
                    {l.sku ? (
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className="font-mono">{l.sku}</Badge>
                        <button
                          type="button"
                          title="Cambiar producto"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => setLinea(i, { productId: null, sku: null })}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <ProductPicker
                          placeholder="Buscar producto…"
                          onSelect={(p) => setLinea(i, { productId: p.id, sku: p.sku, descripcion: p.name })}
                        />
                        <div className="text-[10px] text-amber-700">Sin producto: no descuenta stock en Colppy</div>
                      </div>
                    )}
                  </td>
                  <td className="p-2">
                    <Input value={l.descripcion} className="h-8 text-xs" onChange={(e) => setLinea(i, { descripcion: e.target.value })} />
                  </td>
                  <td className="p-2">
                    <Input value={l.cantidad} inputMode="decimal" className="h-8 text-right text-xs" onChange={(e) => setLinea(i, { cantidad: e.target.value })} />
                  </td>
                  <td className="p-2">
                    <Input value={l.precioFinal} inputMode="decimal" className="h-8 text-right text-xs" onChange={(e) => setLinea(i, { precioFinal: e.target.value })} />
                  </td>
                  <td className="whitespace-nowrap p-2 text-right text-xs">
                    {ars(redondear((num(l.cantidad) || 0) * (num(l.precioFinal) || 0)))}
                  </td>
                  <td className="p-2">
                    <button
                      type="button"
                      title="Quitar línea"
                      className="text-muted-foreground hover:text-red-600"
                      onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-start justify-between border-t p-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLineas((ls) => [...ls, { productId: null, sku: null, descripcion: '', cantidad: '1', precioFinal: '' }])}
            >
              <Plus className="mr-1 h-4 w-4" /> Agregar línea
            </Button>
            <div className="w-64 space-y-0.5 text-sm">
              <div className="flex justify-between"><span>Neto gravado</span><span>{ars(neto)}</span></div>
              <div className="flex justify-between"><span>IVA 21%</span><span>{ars(iva)}</span></div>
              <div className="flex justify-between font-semibold"><span>Total</span><span>{ars(totalFinal)}</span></div>
              {venta && <div className="flex justify-between text-xs text-muted-foreground"><span>Total cobrado en ML</span><span>{ars(venta.total)}</span></div>}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Los precios van finales (con IVA), como en Mercado Libre; la factura discrimina neto e IVA.
        </p>

        {difiere && (
          <div className="flex items-center gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            El total de la factura no coincide con lo cobrado en Mercado Libre.
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={emitiendo}>
            Cancelar
          </Button>
          <Button onClick={emitir} disabled={emitiendo || !esRI || !lineasOk}>
            {emitiendo && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Emitir factura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

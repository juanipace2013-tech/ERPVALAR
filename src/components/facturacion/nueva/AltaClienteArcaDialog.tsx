'use client'

/**
 * Alta rápida de un cliente para la factura directa: CUIT → constancia de
 * ARCA (/api/afip/cuit) → formulario corto → POST /api/clientes (que también
 * lo da de alta en Colppy). Si el CUIT ya está en el ERP, se elige ese.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Loader2, Search, UserCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { esCuitValido } from '@/lib/cuit-utils'
import { formatCUIT } from '@/lib/utils'
import {
  CONDICIONES_ALTA_CLIENTE,
  altaClienteDesdeArca,
  altaClienteDuplicada,
  cuerpoAltaCliente,
  etiquetaCondicionIva,
  validarAltaCliente,
  type ClienteFacturaDirecta,
  type FormAltaCliente,
} from '@/lib/facturacion/factura-directa-ui'
import { cargarClienteFactura } from './cliente-api'

interface Existente {
  id: string
  name: string
  cuit: string
}

async function buscarPorCuit(cuit: string): Promise<Existente | null> {
  const r = await fetch(`/api/clientes/by-cuit/${encodeURIComponent(cuit)}`)
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.found || !d.customer?.id) return null
  return { id: d.customer.id, name: d.customer.name, cuit: d.customer.cuit }
}

export function AltaClienteArcaDialog({
  open,
  onOpenChange,
  onCliente,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCliente: (c: ClienteFacturaDirecta) => void
}) {
  const [cuit, setCuit] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [form, setForm] = useState<FormAltaCliente | null>(null)
  const [existente, setExistente] = useState<Existente | null>(null)
  const [arcaError, setArcaError] = useState<string | null>(null)
  const [arcaInactivo, setArcaInactivo] = useState(false)
  const [creando, setCreando] = useState(false)

  useEffect(() => {
    if (!open) return
    setCuit('')
    setForm(null)
    setExistente(null)
    setArcaError(null)
    setArcaInactivo(false)
  }, [open])

  const digitos = cuit.replace(/\D/g, '')
  const cuitOk = digitos.length === 11 && esCuitValido(digitos)

  const consultar = async () => {
    if (!cuitOk) return
    setConsultando(true)
    setForm(null)
    setExistente(null)
    setArcaError(null)
    setArcaInactivo(false)
    try {
      const ya = await buscarPorCuit(digitos).catch(() => null)
      if (ya) {
        setExistente(ya)
        return
      }
      const r = await fetch(`/api/afip/cuit/${digitos}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.success) {
        setArcaError(d.message || d.error || `ARCA respondió ${r.status}`)
        setForm(altaClienteDesdeArca(digitos, null))
        return
      }
      setArcaInactivo(d.data?.status === 'INACTIVE')
      setForm(altaClienteDesdeArca(digitos, d.data))
    } catch (e) {
      setArcaError((e as Error).message)
      setForm(altaClienteDesdeArca(digitos, null))
    } finally {
      setConsultando(false)
    }
  }

  const usar = async (id: string) => {
    setCreando(true)
    try {
      onCliente(await cargarClienteFactura(id))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreando(false)
    }
  }

  const errores = form ? validarAltaCliente(form, esCuitValido) : []

  const crear = async () => {
    if (!form || errores.length) return
    setCreando(true)
    try {
      const r = await fetch('/api/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpoAltaCliente(form)),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (altaClienteDuplicada(r.status, d.error)) {
          const ya = await buscarPorCuit(form.cuit).catch(() => null)
          if (ya) {
            toast.info(`El CUIT ya estaba cargado: se eligió ${ya.name}`)
            onCliente(await cargarClienteFactura(ya.id))
            return
          }
        }
        const detalle = Array.isArray(d.details) ? d.details.map((x: { message: string }) => x.message).join(', ') : null
        throw new Error(detalle || d.error || 'No se pudo crear el cliente')
      }
      if (d.colppy?.ok) {
        toast.success(d.colppy.creado ? 'Cliente creado en el ERP y dado de alta en Colppy' : 'Cliente creado y vinculado al que ya existía en Colppy')
      } else {
        toast.success('Cliente creado en el ERP')
        toast.warning(`No se pudo dar de alta en Colppy: ${d.colppy?.error ?? 'error desconocido'}. Se crea al registrar la factura en Colppy.`, { duration: 10000 })
      }
      onCliente(await cargarClienteFactura(d.id))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreando(false)
    }
  }

  const set = <K extends keyof FormAltaCliente>(k: K, v: FormAltaCliente[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))

  return (
    <Dialog open={open} onOpenChange={(o) => !creando && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nuevo cliente desde CUIT</DialogTitle>
          <DialogDescription>Se consulta la constancia de ARCA y se da de alta en el ERP y en Colppy.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="alta-cuit">CUIT</Label>
              <Input
                id="alta-cuit"
                value={cuit}
                onChange={(e) => {
                  setCuit(e.target.value)
                  setForm(null)
                  setExistente(null)
                  setArcaError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    consultar()
                  }
                }}
                placeholder="30-12345678-9"
                inputMode="numeric"
                autoComplete="off"
              />
              {digitos.length === 11 && !cuitOk && <p className="text-xs text-red-600">El dígito verificador no cierra</p>}
            </div>
            <Button type="button" onClick={consultar} disabled={!cuitOk || consultando}>
              {consultando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Consultar ARCA
            </Button>
          </div>

          {existente && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
              <span>
                Ya está en el ERP: <b>{existente.name}</b> ({formatCUIT(existente.cuit)})
              </span>
              <Button type="button" size="sm" onClick={() => usar(existente.id)} disabled={creando}>
                <UserCheck className="mr-2 h-4 w-4" />
                Usar este cliente
              </Button>
            </div>
          )}

          {arcaError && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>No se pudo consultar ARCA ({arcaError}). Podés cargar los datos a mano; la vista previa de la factura vuelve a controlar el padrón.</span>
            </div>
          )}
          {arcaInactivo && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>El CUIT figura INACTIVO en ARCA: no se le puede hacer una Factura A.</span>
            </div>
          )}

          {form && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="alta-nombre">Nombre / razón social</Label>
                <Input id="alta-nombre" value={form.name} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Condición frente al IVA</Label>
                <Select value={form.taxCondition} onValueChange={(v) => v && set('taxCondition', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Elegí la condición" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDICIONES_ALTA_CLIENTE.map((c) => (
                      <SelectItem key={c} value={c}>
                        {etiquetaCondicionIva(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={(v) => (v === 'BUSINESS' || v === 'INDIVIDUAL') && set('type', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BUSINESS">Empresa</SelectItem>
                    <SelectItem value="INDIVIDUAL">Persona</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="alta-domicilio">Domicilio</Label>
                <Input id="alta-domicilio" value={form.address} onChange={(e) => set('address', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="alta-localidad">Localidad</Label>
                <Input id="alta-localidad" value={form.city} onChange={(e) => set('city', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="alta-provincia">Provincia</Label>
                <Input id="alta-provincia" value={form.province} onChange={(e) => set('province', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="alta-email">Email (opcional)</Label>
                <Input id="alta-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="alta-plazo">Días de plazo (opcional)</Label>
                <Input id="alta-plazo" inputMode="numeric" value={form.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value.replace(/\D/g, ''))} placeholder="0 = contado" />
              </div>
              {errores.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-red-600 sm:col-span-2">
                  {errores.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={creando}>
            Cancelar
          </Button>
          {form && (
            <Button type="button" onClick={crear} disabled={creando || errores.length > 0}>
              {creando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear cliente
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

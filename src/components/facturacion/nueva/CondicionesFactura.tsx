'use client'

/**
 * Condiciones de la factura directa: moneda y tipo de cambio (BNA billete por
 * defecto, editable), condición de pago, "precios con IVA incluido" (en la B
 * siempre) y, en la B, a quién se factura en ARCA (CUIT del cliente o un
 * DNI/CUIL del comprador: obligatorio desde $10M a consumidor final).
 */
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCUIT } from '@/lib/utils'
import { CONDICIONES_PAGO } from '@/lib/facturacion/condicion-pago'
import { parseNumeroAr } from '@/lib/facturacion/nc-unidades'
import { UMBRAL_IDENTIFICACION_CF, tipoCambioAlejado, type LetraFacturaDirecta } from '@/lib/facturacion/factura-directa-form'
import type { ClienteFacturaDirecta, DocReceptorForm, FormFacturaDirecta } from '@/lib/facturacion/factura-directa-ui'

const fechaCorta = (ymd: string | null) => (ymd ? ymd.split('-').reverse().join('/') : '')

export function CondicionesFactura({
  form,
  onCampo,
  cliente,
  letra,
  tcReferencia,
  cargandoTc,
  onRecargarTc,
  disabled = false,
}: {
  form: FormFacturaDirecta
  onCampo: <K extends keyof FormFacturaDirecta>(k: K, v: FormFacturaDirecta[K]) => void
  cliente: ClienteFacturaDirecta | null
  letra: LetraFacturaDirecta | null
  tcReferencia: { rate: number; fecha: string | null } | null
  cargandoTc: boolean
  onRecargarTc: () => void
  disabled?: boolean
}) {
  const tc = parseNumeroAr(form.tipoCambio)
  const alejado = form.moneda === 'USD' && tcReferencia && tipoCambioAlejado(tc, tcReferencia.rate)
  const cuitCliente = (cliente?.cuit ?? '').replace(/\D/g, '')
  const setDoc = (patch: Partial<DocReceptorForm>) => onCampo('docReceptor', { ...form.docReceptor, ...patch })

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1">
        <Label>Moneda</Label>
        <Select value={form.moneda} onValueChange={(v) => (v === 'ARS' || v === 'USD') && onCampo('moneda', v)} disabled={disabled}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ARS">Pesos (ARS)</SelectItem>
            <SelectItem value="USD">Dólares (USD)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {form.moneda === 'USD' && (
        <div className="space-y-1">
          <Label htmlFor="fd-tc">Tipo de cambio (ARS por USD)</Label>
          <div className="flex gap-1">
            <Input
              id="fd-tc"
              value={form.tipoCambio}
              onChange={(e) => onCampo('tipoCambio', e.target.value)}
              inputMode="decimal"
              placeholder="Ej.: 1450,50"
              className="text-right"
              disabled={disabled}
            />
            <Button type="button" variant="outline" size="icon" onClick={onRecargarTc} disabled={disabled || cargandoTc} title="Usar el último dólar BNA cargado">
              {cargandoTc ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {tcReferencia
              ? `BNA billete venta: ${tcReferencia.rate.toLocaleString('es-AR')}${tcReferencia.fecha ? ` (del ${fechaCorta(tcReferencia.fecha)})` : ''}`
              : 'No hay un dólar BNA cargado'}
          </p>
          {alejado && (
            <p className="flex items-center gap-1 text-[11px] text-amber-700">
              <AlertTriangle className="h-3 w-3" /> Se aleja más de 3% del BNA: se va a pedir confirmación
            </p>
          )}
        </div>
      )}

      <div className="space-y-1">
        <Label>Condición de pago</Label>
        <Select value={form.condicionPago} onValueChange={(v) => v && onCampo('condicionPago', v)} disabled={disabled}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONDICIONES_PAGO.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.etiqueta}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {cliente?.paymentTerms ? <p className="text-[11px] text-muted-foreground">El cliente tiene {cliente.paymentTerms} días de plazo</p> : null}
      </div>

      <div className="space-y-1">
        <Label>Precios</Label>
        <label className={`flex h-9 items-center gap-2 text-sm ${letra === 'B' || disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
          <Checkbox
            checked={letra === 'B' ? true : form.preciosConIva}
            onCheckedChange={(c) => onCampo('preciosConIva', c === true)}
            disabled={letra === 'B' || disabled}
          />
          Precios con IVA incluido
        </label>
        <p className="text-[11px] text-muted-foreground">
          {letra === 'B'
            ? 'Factura B: los precios son finales (IVA contenido)'
            : form.preciosConIva
              ? 'Se tipean precios finales y se discrimina el IVA'
              : 'Se tipean precios netos y se suma el IVA'}
        </p>
      </div>

      {letra === 'B' && (
        <div className="space-y-1 md:col-span-2">
          <Label>Comprador en ARCA</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={form.docReceptor.tipo} onValueChange={(v) => (v === 'CLIENTE' || v === 'DNI' || v === 'CUIL') && setDoc({ tipo: v })} disabled={disabled}>
              <SelectTrigger className="sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CLIENTE">
                  {cuitCliente.length === 11
                    ? `CUIT del cliente (${formatCUIT(cuitCliente)})`
                    : cuitCliente.length >= 7 && cuitCliente.length <= 8
                      ? `DNI del cliente (${cuitCliente})`
                      : 'Consumidor final sin identificar'}
                </SelectItem>
                <SelectItem value="DNI">DNI del comprador</SelectItem>
                <SelectItem value="CUIL">CUIL del comprador</SelectItem>
              </SelectContent>
            </Select>
            {form.docReceptor.tipo !== 'CLIENTE' && (
              <Input
                value={form.docReceptor.nro}
                onChange={(e) => setDoc({ nro: e.target.value })}
                inputMode="numeric"
                placeholder={form.docReceptor.tipo === 'DNI' ? '12345678' : '20-12345678-9'}
                disabled={disabled}
              />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Desde $ {UMBRAL_IDENTIFICACION_CF.toLocaleString('es-AR')} una Factura B a consumidor final tiene que identificar al comprador (RG 5866).
          </p>
        </div>
      )}
    </div>
  )
}

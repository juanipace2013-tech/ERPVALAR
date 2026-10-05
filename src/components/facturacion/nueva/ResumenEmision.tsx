'use client'

/**
 * Vista previa y emisión de la factura directa: lo que va a ARCA (comprobante,
 * receptor, fechas, totales), el padrón, la venta de ML, errores, avisos y las
 * confirmaciones a tildar; el botón "Emitir factura" y lo que pasó al emitir
 * (corregir o reintentar con la misma clave).
 */
import { AlertTriangle, CheckCircle2, Eye, Loader2, RefreshCw, Send, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'
import type { ProblemaFacturaDirecta } from '@/lib/facturacion/factura-directa-form'
import { ETIQUETA_DOC_TIPO, etiquetaComprobante, etiquetaCondicionIva, type VistaPreviaVigente } from '@/lib/facturacion/factura-directa-ui'

const CONDICION_IVA_ARCA: Record<number, string> = {
  1: 'Responsable Inscripto',
  4: 'Exento',
  5: 'Consumidor Final',
  6: 'Monotributista',
  7: 'Sujeto no categorizado',
  15: 'IVA no alcanzado',
}
const fechaAr = (ymd: string) => ymd.split('-').reverse().join('/')

export interface ErrorEmisionUi {
  titulo: string
  problemas: ProblemaFacturaDirecta[]
}

export interface ReintentoUi {
  titulo: string
  mensaje: string
}

export function ResumenEmision({
  vista,
  vigente,
  cargandoVista,
  vistaHabilitada,
  onVistaPrevia,
  tildadas,
  onTildar,
  emision,
  onEmitir,
  emitiendo,
  error,
  reintento,
  onReintentar,
  onDescartarReintento,
  frenada,
  moneda,
}: {
  vista: VistaPreviaVigente | null
  vigente: boolean
  cargandoVista: boolean
  vistaHabilitada: { puede: boolean; motivo: string | null }
  onVistaPrevia: () => void
  /** Firmas de las confirmaciones tildadas */
  tildadas: string[]
  onTildar: (firma: string, si: boolean) => void
  emision: { puede: boolean; motivo: string | null }
  onEmitir: () => void
  emitiendo: boolean
  error: ErrorEmisionUi | null
  reintento: ReintentoUi | null
  onReintentar: () => void
  onDescartarReintento: () => void
  /** Hubo un resultado bloqueante: no se emite más desde esta pantalla */
  frenada: boolean
  /** Moneda del pedido previsualizado */
  moneda: 'ARS' | 'USD'
}) {
  const d = vigente ? vista?.data : null
  const plata = (n: number) => formatCurrency(n, moneda)

  return (
    <div className="space-y-4">
      {/* Reintento con la misma clave (error de red, ARCA sin pedir, en curso) */}
      {reintento && (
        <div className="space-y-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-amber-900">
            <AlertTriangle className="h-5 w-5" />
            {reintento.titulo}
          </p>
          <p className="text-amber-900">{reintento.mensaje}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" onClick={onReintentar} disabled={emitiendo} className="bg-amber-600 text-white hover:bg-amber-700">
              {emitiendo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Reintentar (misma clave)
            </Button>
            <Button type="button" variant="outline" onClick={onDescartarReintento} disabled={emitiendo}>
              Volver a editar
            </Button>
          </div>
          <p className="text-xs text-amber-800">
            Si volvés a editar, el próximo intento va con otra clave: antes revisá en Facturas que esta no haya salido (el servidor igual avisa si hay una
            factura igual reciente).
          </p>
        </div>
      )}

      {/* Error al emitir (hay que corregir) */}
      {error && (
        <div className="space-y-1 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <p className="flex items-center gap-2 font-semibold">
            <XCircle className="h-5 w-5" />
            {error.titulo}
          </p>
          <ul className="list-disc space-y-0.5 pl-6">
            {error.problemas.map((p, i) => (
              <li key={i}>{p.mensaje}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={onVistaPrevia} disabled={!vistaHabilitada.puede || cargandoVista || emitiendo || !!reintento || frenada} title={vistaHabilitada.motivo ?? undefined}>
          {cargandoVista ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
          {vista && !vigente ? 'Actualizar vista previa' : 'Vista previa'}
        </Button>
        {!vistaHabilitada.puede && vistaHabilitada.motivo && <span className="text-xs text-muted-foreground">{vistaHabilitada.motivo}</span>}
        {vista && !vigente && <span className="text-xs text-amber-700">Cambiaste algo: la vista previa quedó desactualizada.</span>}
      </div>

      {d && (
        <div className="space-y-4 rounded-lg border bg-white p-4 text-sm dark:bg-gray-900">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-blue-600 text-white hover:bg-blue-600">{etiquetaComprobante(d.letra, d.esFce)}</Badge>
            {d.cbteTipoPrevisto && <span className="text-xs text-muted-foreground">tipo {d.cbteTipoPrevisto} · punto de venta del ERP</span>}
            {d.ok ? (
              <span className="flex items-center gap-1 text-xs text-green-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Lista para emitir
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-red-700">
                <XCircle className="h-3.5 w-3.5" /> Hay que corregir lo marcado
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
            {d.cliente && (
              <span>
                Cliente: <b>{d.cliente.name}</b> · {etiquetaCondicionIva(d.cliente.taxCondition)}
              </span>
            )}
            {d.receptor && (
              <span>
                Receptor en ARCA: <b>{ETIQUETA_DOC_TIPO[d.receptor.docTipo] ?? `Doc ${d.receptor.docTipo}`}</b>
                {d.receptor.docTipo !== 99 && <span className="font-mono"> {d.receptor.docNro}</span>}
                {CONDICION_IVA_ARCA[d.receptor.condicionIvaId] && <span className="text-muted-foreground"> · {CONDICION_IVA_ARCA[d.receptor.condicionIvaId]}</span>}
              </span>
            )}
            <span>
              Fecha: <b>{fechaAr(d.fechaFactura)}</b> · vence <b>{fechaAr(d.fechaVto)}</b> ({d.condicionPago})
            </span>
            {d.totales && (
              <span>
                {d.letra === 'B' ? (
                  <>
                    Total: <b>{plata(d.totales.total)}</b> · IVA contenido {plata(d.totales.iva)}
                  </>
                ) : (
                  <>
                    Neto {plata(d.totales.neto)} + IVA {plata(d.totales.iva)} = <b>{plata(d.totales.total)}</b>
                  </>
                )}
                {moneda === 'USD' && Number.isFinite(d.totales.totalArs) && (
                  <span className="text-muted-foreground"> (≈ {formatCurrency(d.totales.totalArs, 'ARS')})</span>
                )}
              </span>
            )}
            {d.padron && (
              <span>
                Padrón ARCA:{' '}
                {d.padron.estado === 'encontrado' ? (
                  <>
                    <b>{d.padron.razonSocial ?? '—'}</b> · {etiquetaCondicionIva(d.padron.condicionIva ?? 'CONSUMIDOR_FINAL')}
                    {d.padron.activo === false && <span className="font-semibold text-red-700"> · INACTIVO</span>}
                  </>
                ) : d.padron.estado === 'no-existe' ? (
                  <span className="text-red-700">el CUIT no existe en ARCA</span>
                ) : (
                  <span className="text-amber-700">no disponible</span>
                )}
              </span>
            )}
            {d.ml && (
              <span>
                Venta ML: <b>#{d.ml.packId}</b> · {formatCurrency(d.ml.totalMl, 'ARS')}
                {d.ml.titular === 'otro' && <span className="text-amber-700"> · otro titular</span>}
              </span>
            )}
          </div>

          {d.errores.length > 0 && (
            <ul className="space-y-1 text-red-700">
              {d.errores.map((e, i) => (
                <li key={i} className="flex items-start gap-1">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{e.mensaje}</span>
                </li>
              ))}
            </ul>
          )}
          {d.avisos.length > 0 && (
            <ul className="space-y-1 text-amber-800">
              {d.avisos.map((a, i) => (
                <li key={i} className="flex items-start gap-1">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{a.mensaje}</span>
                </li>
              ))}
            </ul>
          )}

          {d.ok && d.confirmacionesRequeridas.length > 0 && (
            <div className="space-y-2 rounded-md border-2 border-blue-500 bg-blue-50 p-3">
              <p className="font-semibold text-blue-900">Confirmá antes de emitir</p>
              {d.confirmacionesRequeridas.map((c) => (
                <label key={c.firma} className="flex cursor-pointer items-start gap-2 rounded border border-blue-200 bg-white p-2">
                  {/* Con un reintento pendiente no se cambian: el reintento manda las confirmaciones que ya se enviaron */}
                  <Checkbox
                    checked={tildadas.includes(c.firma)}
                    onCheckedChange={(v) => onTildar(c.firma, v === true)}
                    disabled={emitiendo || frenada || !!reintento}
                    className="mt-0.5"
                  />
                  <span>{c.mensaje}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onEmitir} disabled={!emision.puede || emitiendo || !!reintento || frenada} className="bg-blue-600 hover:bg-blue-700" size="lg">
          {emitiendo ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Emitiendo en ARCA…
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Emitir factura
            </>
          )}
        </Button>
        {frenada ? (
          <span className="text-sm font-semibold text-red-700">Hay una emisión sin resolver: no se emite más desde esta pantalla.</span>
        ) : (
          !emision.puede && emision.motivo && !reintento && <span className="text-xs text-muted-foreground">{emision.motivo}</span>
        )}
      </div>
    </div>
  )
}

'use client'

/**
 * Borrador de la factura de una venta de Mercado Libre (Factura A o B, según
 * la pestaña): comprador verificado en el padrón de ARCA + líneas editables
 * (producto, descripción, cantidad, precio final con IVA). Nada se emite
 * hasta que el usuario confirma.
 *
 * Factura B: el CUIT/CUIL sale de ML, del DNI (CUIL buscado en ARCA) o se
 * tipea (obligatorio si no hay): el cliente se da de alta en el ERP y en
 * Colppy con ese número para llevar su cuenta corriente.
 * La letra la decide ARCA: si dice que va por la otra, se ofrece pasar de
 * pestaña (nunca se emite la otra letra desde acá).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertTriangle, Loader2, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ClaseFacturaMl, CompradorMl, DomicilioComprador, PosibleDuplicado } from '@/lib/mercadolibre/facturacion'
import {
  ETIQUETA_CONDICION_IVA,
  PESTANA_FACTURA_ML,
  PROVINCIAS_ERP,
  aplicarRespuestaFacturaEnMl,
  avisoFacturaEnMl,
  avisoOtraClase,
  cuerpoFacturaMl,
  cuitTrasConsulta,
  documentoReceptorTexto,
  estadoFacturaEnMlInicial,
  lineasDesdeVenta,
  motivoNoEmitir,
  notaRedondeoFacturaA,
  numeroBorrador,
  opcionesCuilComprador,
  redondear2,
  textoCondicionArca,
  totalesBorrador,
  validarCuitIngresado,
  type EstadoFacturaEnMlBorrador,
  type LineaBorradorMl,
} from '@/lib/mercadolibre/facturacion-form'
import { ProductPicker } from './ProductPicker'

export interface VentaParaBorrador {
  packId: string
  total: number
  cuit: string | null
  buyerNickname: string | null
  /** La venta ya tiene una factura adjunta en ML (según el listado; null = ML no lo confirmó) */
  facturaEnMl?: boolean | null
  posibleDuplicado?: PosibleDuplicado | null
  items: Array<{
    title: string
    quantity: number
    unitPrice: number
    productId: string | null
    sku: string | null
    productName: string | null
  }>
}

type ErrorEmision = { mensaje: string; claseCorrecta?: ClaseFacturaMl }

const DOMICILIO_VACIO: DomicilioComprador = { direccion: null, localidad: null, provincia: null, codigoPostal: null }

const ars = (n: number) => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })
const dia = (s: string) => new Date(s).toLocaleDateString('es-AR')

const RESULTADO_CANDIDATO: Record<CompradorMl['candidatos'][number]['resultado'], string> = {
  encontrado: 'en ARCA',
  'no-existe': 'no existe',
  error: 'error',
  'sin-consultar': 'sin consultar',
}

export function BorradorFacturaMlDialog({
  venta,
  clase,
  onClose,
  onEmitida,
  onCambiarClase,
}: {
  venta: VentaParaBorrador | null
  /** Pestaña desde la que se factura */
  clase: ClaseFacturaMl
  onClose: () => void
  onEmitida: () => void
  /** ARCA dice que va por la otra letra: la página cambia de pestaña (el borrador sigue abierto) */
  onCambiarClase: (clase: ClaseFacturaMl) => void
}) {
  const [comprador, setComprador] = useState<CompradorMl | null>(null)
  const [cargando, setCargando] = useState(false)
  const [errorComprador, setErrorComprador] = useState<string | null>(null)
  const [cuit, setCuit] = useState('')
  const [errorCuit, setErrorCuit] = useState<string | null>(null)
  const [nombre, setNombre] = useState('')
  const [domicilio, setDomicilio] = useState<DomicilioComprador>(DOMICILIO_VACIO)
  const [lineas, setLineas] = useState<LineaBorradorMl[]>([])
  // "Factura en ML": la respuesta más nueva (/comprador o 409 FACTURA_EN_ML) y
  // la casilla de confirmación, que se destilda si el estado cambia
  const [estadoMl, setEstadoMl] = useState<EstadoFacturaEnMlBorrador>(() => estadoFacturaEnMlInicial(venta?.facturaEnMl))
  // CUIL para elegir (DNI con más de un CUIL en ARCA): quedan visibles aunque se elija uno
  const [opcionesCuil, setOpcionesCuil] = useState<Array<{ cuit: string; nombre: string | null }>>([])
  const [errorEmision, setErrorEmision] = useState<ErrorEmision | null>(null)
  const [emitiendo, setEmitiendo] = useState(false)
  // Descarta respuestas viejas (otra venta u otro CUIT/CUIL)
  const consulta = useRef(0)
  // Turno de cada pedido al servidor (/comprador y POST): gana la respuesta del más nuevo
  const turnoPedido = useRef(0)
  // Cuenta las ediciones del CUIT/CUIL: una consulta en curso no pisa lo que el
  // usuario tipeó después de lanzarla (ni lo da por verificado)
  const edicionCuit = useRef(0)

  /**
   * Comprador según ML + padrón de ARCA (con el CUIT/CUIL tipeado, si hay). No
   * emite nada. `soloSiVacio` (Reintentar): lo tipeado en el campo no se pisa.
   */
  const cargarComprador = useCallback(async (packId: string, cuitManual: string | null, opts: { soloSiVacio?: boolean } = {}) => {
    const n = ++consulta.current
    const turno = ++turnoPedido.current
    const edicionAlPedir = edicionCuit.current
    setCargando(true)
    setErrorComprador(null)
    setErrorEmision(null)
    try {
      const qs = cuitManual ? `?cuit=${encodeURIComponent(cuitManual)}` : ''
      const res = await fetch(`/api/mercadolibre/facturacion/${packId}/comprador${qs}`)
      const json = await res.json()
      if (n !== consulta.current) return
      if (!res.ok) {
        if (json.codigo === 'CUIT_INVALIDO') {
          setErrorCuit(json.error)
          return
        }
        throw new Error(json.error || 'No se pudieron traer los datos del comprador')
      }
      const c = json as CompradorMl
      setComprador(c)
      setEstadoMl((e) => aplicarRespuestaFacturaEnMl(e, { valor: c.facturaEnMl, turno }))
      const opciones = opcionesCuilComprador(c)
      if (opciones.length) setOpcionesCuil(opciones)
      // Si el usuario editó el campo mientras tanto, queda lo que tipeó: el
      // botón Emitir sigue bloqueado hasta verificar ESE número
      setCuit((campo) =>
        cuitTrasConsulta({
          campo,
          deLaConsulta: c.cuit,
          editadoDuranteLaConsulta: edicionCuit.current !== edicionAlPedir,
          soloSiVacio: opts.soloSiVacio,
        })
      )
      setNombre(c.nombreSugerido ?? '')
      setDomicilio(c.domicilioSugerido ?? DOMICILIO_VACIO)
    } catch (e) {
      if (n === consulta.current) setErrorComprador((e as Error).message)
    } finally {
      if (n === consulta.current) setCargando(false)
    }
  }, [])

  // Al abrir: CUIT de ML (si lo informó), líneas de la orden y datos del comprador
  useEffect(() => {
    if (!venta) {
      consulta.current++
      return
    }
    setComprador(null)
    setCuit(venta.cuit ?? '')
    setErrorCuit(null)
    setNombre('')
    setDomicilio(DOMICILIO_VACIO)
    setLineas(lineasDesdeVenta(venta.items))
    setEstadoMl(estadoFacturaEnMlInicial(venta.facturaEnMl))
    turnoPedido.current = 0
    setOpcionesCuil([])
    setErrorEmision(null)
    cargarComprador(venta.packId, null)
  }, [venta, cargarComprador])

  const verificarCuit = (valor: string = cuit) => {
    if (!venta) return
    const v = validarCuitIngresado(valor)
    if (!v.ok) {
      setErrorCuit(v.mensaje ?? 'Ingresá el CUIT/CUIL del comprador')
      return
    }
    setErrorCuit(null)
    setCuit(v.cuit)
    cargarComprador(venta.packId, v.cuit)
  }

  /** Elige uno de los CUIL del DNI: lo pone en el campo y lo verifica en ARCA */
  const elegirCuil = (c: string) => {
    edicionCuit.current++
    setErrorEmision(null)
    verificarCuit(c)
  }

  const pasarA = (c: ClaseFacturaMl) => {
    setErrorEmision(null)
    onCambiarClase(c)
  }

  const setLinea = (i: number, patch: Partial<LineaBorradorMl>) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const setDom = (patch: Partial<DomicilioComprador>) => setDomicilio((d) => ({ ...d, ...patch }))

  const validacion = validarCuitIngresado(cuit)
  const cuitVerificado = !!comprador?.cuit && validacion.ok && validacion.cuit === comprador.cuit
  // true = ya tiene factura en ML; null = ML no lo confirmó (también pide confirmación); false = no tiene
  const facturaEnMl = estadoMl.valor
  const confirmaFacturaEnMl = estadoMl.confirmado
  // Candado del ERP (ya facturada / en emisión): nada que confirmar ni emitir
  const yaFacturada = comprador?.yaFacturada ?? null
  const avisoMl = yaFacturada ? null : avisoFacturaEnMl(facturaEnMl)
  const textoCondicion = comprador ? textoCondicionArca(comprador) : null
  const posibleDuplicado = comprador ? comprador.posibleDuplicado : (venta?.posibleDuplicado ?? null)
  const aviso = comprador && cuitVerificado ? avisoOtraClase(comprador, clase) : null
  // B y ARCA no tiene al comprador: el alta usa nombre y domicilio del borrador
  const editaAlta = clase === 'B' && cuitVerificado && comprador?.padron !== 'encontrado'
  // Lo que se va a emitir: la A discrimina el IVA y redondea (neto primero)
  const { total, neto, iva } = totalesBorrador(lineas, clase)
  const difiere = venta ? Math.abs(total - venta.total) >= 1 : false
  const notaRedondeo = venta ? notaRedondeoFacturaA(clase, total, venta.total) : null
  // Lo que informó ML del comprador (referencia: la condición la decide ARCA)
  const datosMl = [
    comprador?.nombreMl,
    venta?.buyerNickname,
    comprador?.condicionMl,
    comprador?.documentoMl && `${comprador.documentoMl.tipo === 'DNI' ? 'DNI' : 'CUIT/CUIL'} ${comprador.documentoMl.numero}`,
    comprador?.fiscalError && `sin datos fiscales (${comprador.fiscalError})`,
  ].filter((x): x is string => !!x)
  const bloqueo = cargando
    ? 'Consultando Mercado Libre y ARCA…'
    : motivoNoEmitir({ clase, comprador, cuitIngresado: cuit, nombre, lineas, facturaEnMl, confirmaFacturaEnMl })

  const emitir = async () => {
    if (!venta || !comprador || bloqueo || !validacion.ok) return
    const nombreFactura = editaAlta ? nombre.trim() : (comprador.razonSocial ?? comprador.nombreSugerido ?? '')
    const ok = window.confirm(
      `¿Emitir Factura ${clase} por ${ars(total)} a ${nombreFactura} (${validacion.cuit})?${notaRedondeo ? `\n(${notaRedondeo}.)` : ''}\n\nSale por el punto de venta 0007 (ARCA), se registra en Colppy y se sube a la venta de Mercado Libre. No se puede deshacer (solo con nota de crédito).`
    )
    if (!ok) return
    const turno = ++turnoPedido.current
    setEmitiendo(true)
    setErrorEmision(null)
    try {
      const res = await fetch('/api/mercadolibre/facturacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          cuerpoFacturaMl({
            packId: venta.packId,
            clase,
            cuit: validacion.cuit,
            lineas,
            facturaEnMl,
            confirmaFacturaEnMl,
            padron: comprador.padron,
            nombre,
            domicilio,
          })
        ),
      })
      const json = await res.json()
      if (!res.ok) {
        const mensaje = json.error || 'Error al facturar'
        if (json.codigo === 'YA_FACTURADA') {
          toast.error(mensaje, { duration: 10000 })
          onEmitida()
          return
        }
        if (json.codigo === 'ARCA_INCIERTO') {
          // El candado queda puesto: la venta pasa a "revisar" en el listado
          toast.error(mensaje, { duration: 30000 })
          onEmitida()
          return
        }
        if (json.codigo === 'FACTURA_EN_ML') {
          // Estado nuevo de ML: hay que volver a confirmar sabiendo lo que hay
          setEstadoMl((e) => aplicarRespuestaFacturaEnMl(e, { valor: json.facturaEnMl === null ? null : true, turno, destildar: true }))
        }
        setErrorEmision({ mensaje, claseCorrecta: json.claseCorrecta === 'A' || json.claseCorrecta === 'B' ? json.claseCorrecta : undefined })
        toast.error(mensaje, { duration: 10000 })
        return
      }
      toast.success(`Factura ${json.invoiceNumber} emitida (CAE ${json.cae})`)
      if (json.colppyPendiente) toast.warning('No se pudo registrar en Colppy: reintentalo desde la factura')
      if (json.colppyBorradorFce)
        toast.warning('Salió como Factura de Crédito MiPyME: en Colppy quedó como BORRADOR. Tildá "Factura de crédito electrónica MiPyME (FCE)" y aprobala.', { duration: 20000 })
      if (!json.mlUpload?.ok) toast.warning(`La factura no se pudo subir a Mercado Libre: ${json.mlUpload?.error ?? ''}`)
      onEmitida()
    } catch (e) {
      setErrorEmision({ mensaje: (e as Error).message })
      toast.error((e as Error).message, { duration: 10000 })
    } finally {
      setEmitiendo(false)
    }
  }

  return (
    <Dialog open={!!venta} onOpenChange={(o) => !o && !emitiendo && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            Borrador de Factura {clase} — venta ML #{venta?.packId}
          </DialogTitle>
          <DialogDescription>
            Revisá y corregí los datos. No se emite nada hasta que confirmes. {PESTANA_FACTURA_ML[clase]}, punto de venta 0007.
            {clase === 'B' && ' El cliente queda en el ERP y en Colppy con su CUIT/CUIL (cuenta corriente propia).'}
          </DialogDescription>
        </DialogHeader>

        {/* Comprador */}
        <div className="rounded-md border p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm font-semibold">Comprador</div>
            {datosMl.length > 0 && <div className="text-xs text-muted-foreground">Según ML: {datosMl.join(' · ')}</div>}
          </div>
          <div className="flex flex-wrap items-start gap-4">
            <div className="w-72 space-y-1">
              <div className="flex items-center gap-2">
                <Input
                  value={cuit}
                  placeholder={clase === 'B' ? 'CUIT/CUIL' : 'CUIT'}
                  aria-label="CUIT/CUIL del comprador"
                  className={cn('h-9 w-44 font-mono', errorCuit && 'border-red-400')}
                  onChange={(e) => {
                    // Campo editado: ninguna consulta en curso lo pisa (ver cargarComprador)
                    edicionCuit.current++
                    setCuit(e.target.value)
                    setErrorCuit(null)
                    setErrorEmision(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && verificarCuit()}
                />
                <Button size="sm" variant="outline" onClick={() => verificarCuit()} disabled={cargando || emitiendo || !venta}>
                  {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  <span className="ml-1">ARCA</span>
                </Button>
              </div>
              {errorCuit && <div className="text-xs text-red-600">{errorCuit}</div>}
              {cuitVerificado && comprador && (
                <div className="text-xs text-muted-foreground">
                  {comprador.origen === 'ml' && 'Informado por Mercado Libre.'}
                  {comprador.origen === 'manual' && 'Ingresado a mano.'}
                  {comprador.origen === 'padron' &&
                    (comprador.candidatos.filter((c) => c.resultado === 'encontrado').length > 1
                      ? `Con el DNI ${comprador.documentoMl?.numero ?? ''} ARCA tiene más de un CUIL: se eligió el que coincide con el nombre de ML. Revisalo.`
                      : `CUIL armado con el DNI ${comprador.documentoMl?.numero ?? ''} y confirmado en ARCA (el único de ese DNI).`)}
                </div>
              )}
              {comprador && comprador.candidatos.length > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  CUIL probados: {comprador.candidatos.map((c) => `${c.cuit} (${RESULTADO_CANDIDATO[c.resultado]})`).join(', ')}
                </div>
              )}
              {opcionesCuil.length > 0 && (
                <div className="space-y-1 pt-1">
                  <div className="text-xs font-medium">Con ese DNI ARCA tiene más de un CUIL: elegí el del comprador</div>
                  {opcionesCuil.map((o) => (
                    <Button
                      key={o.cuit}
                      size="sm"
                      variant={cuitVerificado && comprador?.cuit === o.cuit ? 'default' : 'outline'}
                      className="h-auto w-full justify-start whitespace-normal py-1 text-left text-xs"
                      disabled={cargando || emitiendo}
                      onClick={() => elegirCuil(o.cuit)}
                    >
                      <span className="font-mono">{o.cuit}</span>
                      {o.nombre && <span className="ml-1">{o.nombre}</span>}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            <div className="min-w-[280px] flex-1 space-y-1 text-sm">
              {errorComprador ? (
                <div className="flex flex-wrap items-center gap-2 text-red-600">
                  {errorComprador}
                  {venta && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      // Lo tipeado en el campo (válido o no) no se pisa: solo se completa si está vacío
                      onClick={() => cargarComprador(venta.packId, validacion.ok ? validacion.cuit : null, { soloSiVacio: true })}
                    >
                      <RefreshCw className="mr-1 h-3 w-3" /> Reintentar
                    </Button>
                  )}
                </div>
              ) : !comprador ? (
                <span className="text-muted-foreground">
                  <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Consultando Mercado Libre y ARCA…
                </span>
              ) : yaFacturada ? (
                <span className="text-muted-foreground">No hay nada para emitir: ver el aviso.</span>
              ) : !cuitVerificado ? (
                <span className="text-muted-foreground">
                  {cuit.trim()
                    ? 'Verificá el número en ARCA (botón ARCA o Enter).'
                    : `Cargá el ${clase === 'B' ? 'CUIT/CUIL' : 'CUIT'} del comprador y verificalo en ARCA.`}
                </span>
              ) : (
                <>
                  {(comprador.razonSocial || !editaAlta) && (
                    <div className="font-medium">{comprador.razonSocial ?? comprador.nombreSugerido}</div>
                  )}
                  {comprador.domicilioPadron && (
                    <div className="text-muted-foreground">
                      {[comprador.domicilioPadron.direccion, comprador.domicilioPadron.localidad, comprador.domicilioPadron.provincia]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                  )}
                  {comprador.clase ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        className={
                          comprador.clase === clase ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }
                      >
                        Factura {comprador.clase}
                        {comprador.condicionIva && ` · ${ETIQUETA_CONDICION_IVA[comprador.condicionIva]}`}
                        {comprador.condicionIva === 'MONOTRIBUTO' && ' (RG 5003)'}
                      </Badge>
                      {comprador.receptor && (
                        <span className="text-xs text-muted-foreground">
                          Se informa a ARCA como {documentoReceptorTexto(comprador.receptor)}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="text-red-600">{comprador.motivo ?? 'No se pudo determinar la factura que corresponde'}</div>
                  )}
                  {textoCondicion && <div className="text-xs text-muted-foreground">{textoCondicion}</div>}
                  {clase === 'B' && comprador.padron === 'encontrado' && comprador.clase === 'B' && (
                    <div className="text-xs text-muted-foreground">
                      Si no existe en el ERP, el cliente se da de alta con estos datos de ARCA; si ya existe con ese CUIT/CUIL, se usa el existente.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {yaFacturada && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <div className="flex-1">{comprador?.motivo}</div>
              {yaFacturada.invoiceId && (
                <Link href={`/facturas/${yaFacturada.invoiceId}`} target="_blank" className="font-mono underline">
                  Ver factura
                </Link>
              )}
            </div>
          )}

          {!yaFacturada && comprador?.origen === 'manual-requerido' && comprador.motivo && !cuitVerificado && (
            <div className="mt-3 flex gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <b>CUIT/CUIL obligatorio.</b> {comprador.motivo}
              </div>
            </div>
          )}

          {aviso && comprador?.clase && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <div className="flex-1">{aviso}</div>
              <Button size="sm" variant="outline" className="h-7" onClick={() => pasarA(comprador.clase!)}>
                Pasar a Factura {comprador.clase}
              </Button>
            </div>
          )}

          {editaAlta && comprador?.clase === 'B' && (
            <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-4">
              <p className="text-xs text-muted-foreground sm:col-span-4">
                ARCA no tiene los datos de este comprador: el alta en el ERP y en Colppy usa estos (precargados de Mercado Libre).
                Si el cliente ya existe en el ERP con ese CUIT/CUIL, se usan los suyos.
              </p>
              <div className="space-y-1 sm:col-span-4">
                <Label htmlFor="ml-alta-nombre" className="text-xs">Nombre y apellido / razón social *</Label>
                <Input id="ml-alta-nombre" value={nombre} className={cn('h-8', !nombre.trim() && 'border-red-400')} onChange={(e) => setNombre(e.target.value)} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="ml-alta-direccion" className="text-xs">Dirección</Label>
                <Input id="ml-alta-direccion" value={domicilio.direccion ?? ''} className="h-8" onChange={(e) => setDom({ direccion: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ml-alta-localidad" className="text-xs">Localidad</Label>
                <Input id="ml-alta-localidad" value={domicilio.localidad ?? ''} className="h-8" onChange={(e) => setDom({ localidad: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ml-alta-cp" className="text-xs">Código postal</Label>
                <Input id="ml-alta-cp" value={domicilio.codigoPostal ?? ''} className="h-8" onChange={(e) => setDom({ codigoPostal: e.target.value })} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Provincia</Label>
                <Select value={domicilio.provincia ?? ''} onValueChange={(v) => setDom({ provincia: v })}>
                  <SelectTrigger className="h-8 w-full" aria-label="Provincia">
                    <SelectValue placeholder="Provincia" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVINCIAS_ERP.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        {/* Factura ya adjunta en ML (o ML no lo pudo confirmar) / posible factura hecha a mano */}
        {avisoMl && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>{avisoMl.texto}</div>
            </div>
            <div className="mt-2 flex items-center gap-2 pl-6">
              <Checkbox
                id="ml-confirma-factura-en-ml"
                checked={confirmaFacturaEnMl}
                // Vale para el estado que se ve: si cambia, se destilda (aplicarRespuestaFacturaEnMl)
                onCheckedChange={(v) => setEstadoMl((e) => ({ ...e, confirmado: v === true }))}
              />
              <Label htmlFor="ml-confirma-factura-en-ml" className="font-normal leading-snug">
                {avisoMl.casilla}
              </Label>
            </div>
          </div>
        )}
        {posibleDuplicado && (
          <div className="flex gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              ¿Ya se facturó a mano? El ERP tiene la factura{' '}
              <Link href={`/facturas/${posibleDuplicado.invoiceId}`} target="_blank" className="font-mono underline">
                {posibleDuplicado.invoiceNumber}
              </Link>{' '}
              del {dia(posibleDuplicado.issueDate)} por {ars(posibleDuplicado.total)}
              {comprador?.cuit ? ` a ${comprador.cuit}` : ''}. Revisala antes de emitir.
            </div>
          </div>
        )}

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
                    {ars(redondear2((numeroBorrador(l.cantidad) || 0) * (numeroBorrador(l.precioFinal) || 0)))}
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
            <div className="w-72 space-y-0.5 text-sm">
              {clase === 'A' && (
                <>
                  <div className="flex justify-between"><span>Neto gravado</span><span>{ars(neto)}</span></div>
                  <div className="flex justify-between"><span>IVA 21%</span><span>{ars(iva)}</span></div>
                </>
              )}
              <div className="flex justify-between font-semibold"><span>Total</span><span>{ars(total)}</span></div>
              {clase === 'B' && (
                <div className="flex justify-between text-xs text-muted-foreground"><span>IVA contenido (Ley 27.743)</span><span>{ars(iva)}</span></div>
              )}
              {venta && <div className="flex justify-between text-xs text-muted-foreground"><span>Total cobrado en ML</span><span>{ars(venta.total)}</span></div>}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {clase === 'A'
            ? 'Los precios van finales (con IVA), como en Mercado Libre; la factura discrimina neto e IVA.'
            : 'Los precios van finales (con IVA), como en Mercado Libre; la Factura B no discrimina el IVA: lo informa como IVA contenido (Régimen de Transparencia Fiscal al Consumidor).'}
        </p>

        {notaRedondeo && <p className="text-xs text-muted-foreground">{notaRedondeo}.</p>}

        {difiere && (
          <div className="flex items-center gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            El total de la factura no coincide con lo cobrado en Mercado Libre.
          </div>
        )}

        {errorEmision && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <div className="flex-1">{errorEmision.mensaje}</div>
            {errorEmision.claseCorrecta && errorEmision.claseCorrecta !== clase && (
              <Button size="sm" variant="outline" className="h-7" onClick={() => pasarA(errorEmision.claseCorrecta!)}>
                Pasar a Factura {errorEmision.claseCorrecta}
              </Button>
            )}
          </div>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">{bloqueo}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={emitiendo}>
              Cancelar
            </Button>
            <Button onClick={emitir} disabled={emitiendo || !!bloqueo}>
              {emitiendo && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Emitir Factura {clase}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

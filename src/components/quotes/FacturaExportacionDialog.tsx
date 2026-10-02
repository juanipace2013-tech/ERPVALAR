/**
 * Componente: FacturaExportacionDialog
 * Emite la Factura E (exportación, ARCA WSFEX) de una cotización de un cliente
 * del exterior. v1: régimen Exporta Simple, en USD y en español.
 *
 *  1. Chequeo previo de los datos del cliente (link para editarlo).
 *  2. Ítems pendientes de la cotización (cantidad editable, sin IVA) y líneas
 *     manuales de flete/seguro (no comisionan ni integran el FOB).
 *  3. Exportación: N° de DES y FOB del DES (= mercadería al centavo),
 *     Incoterm + lugar, forma de pago, país destino, observaciones.
 *  4. Moneda: USD con la cotización oficial de ARCA (con su fecha) y
 *     CanMisMonExt ("el cliente paga en dólares").
 *  5. Resumen, "Vista previa" (dryRun: el request exacto sin emitir) y
 *     "Emitir Factura E" con confirmación.
 *
 * Endpoint: GET/POST /api/quotes/[id]/factura-exportacion. El servidor vuelve
 * a validar todo y es el único que decide. Diseño: docs/FACTURA-E-WSFEX-PLAN.md
 * (sección 5). Se usa desde la cotización y desde el tablero de facturación.
 */

'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import type {
  PrefillFacturaExportacion,
  VistaPreviaFacturaExportacion,
} from '@/lib/facturacion/factura-exportacion'
import {
  DESCRIPCION_FLETE_DEFAULT,
  MAX_FORMA_PAGO,
  MAX_INCOTERM_LUGAR,
  MAX_LINEAS_MANUALES_FORM,
  MAX_OBS_COMERCIALES,
  armarPedidoFacturaE,
  formatearFechaArca,
  indentarXml,
  normalizarDesForm,
  textoErrorArca,
  validarFormularioFacturaE,
  type FilaItemFacturaE,
  type FormFacturaE,
  type LineaManualFacturaE,
} from '@/lib/facturacion/factura-exportacion-form'

// ============================================================================
// TIPOS
// ============================================================================

interface FacturaExportacionDialogProps {
  quoteId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Después de un intento de emisión que pudo cambiar datos: refrescar la
   * cotización o el tablero. null = resultado incierto o huérfano (no hay
   * Invoice confirmada).
   */
  onEmitted?: (r: { invoiceId: string; numero: string; cae: string } | null) => void
  /** Ítems preseleccionados (tablero de facturación). Sin esto, todos los pendientes. */
  quoteItemIds?: string[]
  /** Texto opcional debajo de la descripción */
  subtitle?: string
}

/** Respuesta OK del POST (emisión) */
interface EmisionOk {
  success: true
  message: string
  invoiceId: string
  numero: string
  numeroFormateado: string
  cae: string
  caeVencimiento: string
  fexId: number
  reproceso: boolean
  recuperado: boolean
  observaciones?: unknown[]
  colppyManual: true
  pdfUrl: string | null
  facturaUrl: string
}

/** Cuerpo de error de la API (todas las variantes) */
interface ErrorApi {
  error?: string
  message?: string
  errores?: unknown[]
  errorCode?: string
  errorStage?: string
  estado?: string
  fexId?: number
  numero?: string
  cae?: string
  cotizacion?: PrefillFacturaExportacion['cotizacion']
}

/** Resultado que obliga a parar y NO reintentar */
interface Bloqueante {
  tipo: 'INCIERTA' | 'HUERFANA' | 'SIN_RESPUESTA'
  mensaje: string
  numero?: string
  cae?: string
  fexId?: number
}

const FORM_VACIO: FormFacturaE = {
  filas: [],
  manuales: [],
  desNumero: '',
  fob: '',
  incoterm: '',
  incotermLugar: '',
  formaPago: '',
  obsComerciales: '',
  cancelaEnMonedaExtranjera: true,
}

const TIPO_PERSONA_LABEL: Record<string, string> = {
  JURIDICA: 'Persona jurídica',
  FISICA: 'Persona física',
  OTRO: 'Otro tipo de entidad',
}

const usd = (n: number) => formatCurrency(n, 'USD')
const ars = (n: number) => formatCurrency(n, 'ARS')
const nroPv = (pv: number | null | undefined) => String(pv ?? 0).padStart(4, '0')

// ============================================================================
// COMPONENTE
// ============================================================================

export function FacturaExportacionDialog({
  quoteId,
  open,
  onOpenChange,
  onEmitted,
  quoteItemIds,
  subtitle,
}: FacturaExportacionDialogProps) {
  const router = useRouter()

  const [prefill, setPrefill] = useState<PrefillFacturaExportacion | null>(null)
  const [cargando, setCargando] = useState(false)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [form, setForm] = useState<FormFacturaE>(FORM_VACIO)

  const [vista, setVista] = useState<{ data: VistaPreviaFacturaExportacion; firma: string } | null>(null)
  const [cargandoVista, setCargandoVista] = useState(false)
  const [erroresServidor, setErroresServidor] = useState<{ titulo: string; lineas: string[] } | null>(null)

  const [confirmando, setConfirmando] = useState(false)
  const [verificado, setVerificado] = useState(false)
  const [emitiendo, setEmitiendo] = useState(false)
  const [bloqueante, setBloqueante] = useState<Bloqueante | null>(null)
  // Después de un resultado incierto, huérfano o sin respuesta no se vuelve a emitir desde acá
  const [frenado, setFrenado] = useState(false)

  // Clave estable de la preselección (evita recargar en cada render del padre)
  const preseleccion = quoteItemIds?.join(',') ?? ''

  // --------------------------------------------------------------------------
  // Carga (prellenado)
  // --------------------------------------------------------------------------

  /** `conservar`: volver a leer el cliente y los pendientes sin perder lo que ya se cargó en el formulario */
  const cargar = useCallback(async (opts: { conservar?: boolean } = {}) => {
    setCargando(true)
    setErrorCarga(null)
    try {
      const r = await fetch(`/api/quotes/${quoteId}/factura-exportacion`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error((d as ErrorApi).error || 'No se pudo cargar la Factura E')
      const p = d as PrefillFacturaExportacion
      const elegidos = preseleccion ? new Set(preseleccion.split(',')) : null
      setPrefill(p)
      const nuevo: FormFacturaE = {
        filas: p.items.map(
          (it): FilaItemFacturaE => ({
            quoteItemId: it.quoteItemId,
            itemNumber: it.itemNumber,
            codigo: it.codigo,
            descripcionOriginal: it.descripcion,
            descripcion: it.descripcion,
            cantidadCotizada: it.cantidadCotizada,
            cantidadPendiente: it.cantidadPendiente,
            cantidad: String(it.cantidadPendiente),
            precioOriginal: it.precioUnitario,
            precio: String(it.precioUnitario),
            descuentoPct: it.descuentoPct,
            incluido: elegidos ? elegidos.has(it.quoteItemId) : true,
          })
        ),
        manuales: [],
        desNumero: '',
        fob: '',
        incoterm: p.defaults.incoterm,
        incotermLugar: p.defaults.incotermLugar,
        formaPago: p.defaults.formaPago,
        obsComerciales: p.quote.purchaseOrderNumber ? `OC ${p.quote.purchaseOrderNumber}` : '',
        cancelaEnMonedaExtranjera: p.defaults.cancelaEnMonedaExtranjera,
      }
      setForm((prev) => {
        if (!opts.conservar) return nuevo
        // Se conservan los datos tipeados y lo editado en cada ítem que sigue pendiente
        const previas = new Map(prev.filas.map((f) => [f.quoteItemId, f]))
        return {
          ...prev,
          filas: nuevo.filas.map((f) => {
            const ant = previas.get(f.quoteItemId)
            return ant ? { ...f, descripcion: ant.descripcion, cantidad: ant.cantidad, precio: ant.precio, incluido: ant.incluido } : f
          }),
        }
      })
    } catch (e) {
      setPrefill(null)
      setErrorCarga((e as Error).message)
    } finally {
      setCargando(false)
    }
  }, [quoteId, preseleccion])

  useEffect(() => {
    if (!open) return
    setVista(null)
    setErroresServidor(null)
    setConfirmando(false)
    setVerificado(false)
    setFrenado(false)
    cargar()
  }, [open, cargar])

  // --------------------------------------------------------------------------
  // Edición (cualquier cambio invalida la confirmación)
  // --------------------------------------------------------------------------

  const actualizar = (fn: (f: FormFacturaE) => FormFacturaE) => {
    setForm(fn)
    setConfirmando(false)
    setVerificado(false)
  }
  const setCampo = <K extends keyof FormFacturaE>(k: K, v: FormFacturaE[K]) => actualizar((f) => ({ ...f, [k]: v }))
  const setFila = (i: number, patch: Partial<FilaItemFacturaE>) =>
    actualizar((f) => ({ ...f, filas: f.filas.map((x, j) => (j === i ? { ...x, ...patch } : x)) }))
  const setManual = (i: number, patch: Partial<LineaManualFacturaE>) =>
    actualizar((f) => ({ ...f, manuales: f.manuales.map((x, j) => (j === i ? { ...x, ...patch } : x)) }))
  const agregarManual = () =>
    actualizar((f) => ({
      ...f,
      manuales: [
        ...f.manuales,
        { descripcion: f.manuales.length === 0 ? DESCRIPCION_FLETE_DEFAULT : '', importe: '' },
      ],
    }))
  const quitarManual = (i: number) => actualizar((f) => ({ ...f, manuales: f.manuales.filter((_, j) => j !== i) }))

  // --------------------------------------------------------------------------
  // Derivados
  // --------------------------------------------------------------------------

  const incoterms = useMemo(() => prefill?.incoterms ?? [], [prefill])
  const validacion = useMemo(() => validarFormularioFacturaE(form, incoterms), [form, incoterms])
  const { calculo } = validacion
  const cotizacion = prefill?.cotizacion ?? null
  const incotermSel = incoterms.find((i) => i.codigo === form.incoterm)

  // Firma del pedido: si cambia algo después de la vista previa, queda desactualizada
  const firmaActual = useMemo(
    () => JSON.stringify(armarPedidoFacturaE(form, { cotizacionEsperada: cotizacion?.cotizacion })),
    [form, cotizacion]
  )
  const vistaVigente = !!vista && vista.firma === firmaActual

  const bloqueos = prefill?.bloqueos ?? []
  // Los datos faltantes del cliente se muestran en su propio recuadro
  const bloqueosGenerales = prefill?.faltantesCliente.length
    ? bloqueos.filter((b) => !b.startsWith('Faltan datos del cliente'))
    : bloqueos
  const listo = !!prefill && !cargando && bloqueos.length === 0 && validacion.errores.length === 0
  const puedeEmitir = listo && !frenado && !emitiendo
  const desNormalizado = normalizarDesForm(form.desNumero)

  // --------------------------------------------------------------------------
  // Respuestas de error del servidor
  // --------------------------------------------------------------------------

  const manejarError = (status: number, d: ErrorApi, enEmision: boolean) => {
    if (d.errorCode === 'FEX_INCIERTA') {
      setFrenado(true)
      setBloqueante({ tipo: 'INCIERTA', mensaje: d.error || 'ARCA no confirmó la Factura E', fexId: d.fexId })
      return
    }
    if (d.errorCode === 'FEX_ORPHAN') {
      setFrenado(true)
      setBloqueante({
        tipo: 'HUERFANA',
        mensaje: d.message || d.error || 'La Factura E se emitió en ARCA pero el ERP no pudo registrarla',
        numero: d.numero,
        cae: d.cae,
        fexId: d.fexId,
      })
      return
    }
    if (status === 409 && d.cotizacion) {
      // La cotización oficial de ARCA cambió entre que se abrió el diálogo y la emisión
      const nueva = d.cotizacion
      setPrefill((p) => (p ? { ...p, cotizacion: nueva } : p))
      setConfirmando(false)
      setVerificado(false)
      toast.warning('Cambió la cotización oficial de ARCA', {
        description: `${d.error ?? ''} Revisá el resumen y confirmá de nuevo.`.trim(),
        duration: 15000,
      })
      return
    }
    // Emisión sin respuesta reconocible (proxy caído, timeout): el resultado es desconocido
    if (enEmision && status >= 500 && !d.error) {
      setFrenado(true)
      setBloqueante({
        tipo: 'SIN_RESPUESTA',
        mensaje:
          `El servidor no respondió bien a la emisión (HTTP ${status}). La Factura E pudo haberse emitido igual: ` +
          'NO REINTENTES. Revisá las facturas de la cotización y, si no aparece, avisá para reconciliarla con scripts/arca-fex-reconciliar.ts.',
      })
      return
    }
    const lineas = Array.isArray(d.errores) && d.errores.length ? d.errores.map(textoErrorArca) : [d.error || `Error ${status}`]
    const titulo =
      d.errorCode === 'FEX_BLOQUEADA'
        ? 'Emisión bloqueada: hay un comprobante de exportación sin resolver'
        : status === 422 && d.errorStage === 'arca'
          ? 'ARCA rechazó la Factura E (no se consumió el número: corregí y volvé a emitir)'
          : status === 400
            ? 'Datos a corregir (no se llamó a ARCA)'
            : status === 502
              ? 'No se pudo consultar ARCA (no se emitió nada)'
              : status === 503
                ? 'Factura E no configurada'
                : enEmision && status >= 500
                  ? 'Error al emitir: antes de reintentar, revisá en la cotización que no haya quedado una Factura E'
                  : 'No se pudo emitir la Factura E'
    setErroresServidor({ titulo, lineas })
  }

  // --------------------------------------------------------------------------
  // Vista previa (dryRun) y emisión
  // --------------------------------------------------------------------------

  const pedirVistaPrevia = async () => {
    setCargandoVista(true)
    setErroresServidor(null)
    const firma = firmaActual
    try {
      const r = await fetch(`/api/quotes/${quoteId}/factura-exportacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(armarPedidoFacturaE(form, { cotizacionEsperada: cotizacion?.cotizacion, dryRun: true })),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        manejarError(r.status, d as ErrorApi, false)
        return
      }
      setVista({ data: d as VistaPreviaFacturaExportacion, firma })
    } catch (e) {
      toast.error('No se pudo armar la vista previa', { description: (e as Error).message })
    } finally {
      setCargandoVista(false)
    }
  }

  const emitir = async () => {
    if (!puedeEmitir || !verificado) return
    setEmitiendo(true)
    setErroresServidor(null)
    try {
      let r: Response
      try {
        r = await fetch(`/api/quotes/${quoteId}/factura-exportacion`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(armarPedidoFacturaE(form, { cotizacionEsperada: cotizacion?.cotizacion })),
        })
      } catch (e) {
        // Se cortó la conexión con el pedido en vuelo: el servidor pudo haber emitido
        setFrenado(true)
        setBloqueante({
          tipo: 'SIN_RESPUESTA',
          mensaje:
            `Se perdió la conexión mientras se emitía (${(e as Error).message}). La Factura E pudo haberse emitido igual: ` +
            'NO REINTENTES. Recargá la cotización y revisá sus facturas; si no aparece, avisá para reconciliarla.',
        })
        return
      }
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        manejarError(r.status, d as ErrorApi, true)
        return
      }
      const ok = d as EmisionOk
      toast.success(`Factura E ${ok.numeroFormateado || ok.numero} emitida`, {
        description: `CAE ${ok.cae}. No se carga sola en Colppy: cargala a mano y pegá el id de Colppy en la factura.`,
        duration: 20000,
        action: ok.facturaUrl ? { label: 'Ver factura', onClick: () => router.push(ok.facturaUrl) } : undefined,
      })
      if (ok.recuperado || ok.reproceso) {
        toast.info('Emisión recuperada', {
          description: ok.recuperado
            ? 'ARCA no había respondido: el CAE se recuperó consultando el comprobante (FEXGetCMP).'
            : 'ARCA devolvió el comprobante ya procesado para el mismo Id (reproceso).',
          duration: 15000,
        })
      }
      for (const o of ok.observaciones ?? []) {
        toast.warning('Observación de ARCA', { description: textoErrorArca(o), duration: 20000 })
      }
      onOpenChange(false)
      onEmitted?.({ invoiceId: ok.invoiceId, numero: ok.numero, cae: ok.cae })
    } finally {
      setEmitiendo(false)
      setConfirmando(false)
      setVerificado(false)
    }
  }

  const copiar = async (texto: string, que: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success(`${que} copiado`)
    } catch {
      toast.error('No se pudo copiar al portapapeles')
    }
  }

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  const ambienteBadge =
    prefill?.ambiente === 'prod' ? (
      <Badge className="bg-red-100 text-red-800 border border-red-300 hover:bg-red-100">PRODUCCIÓN</Badge>
    ) : prefill?.ambiente === 'homo' ? (
      <Badge className="bg-sky-100 text-sky-800 border border-sky-300 hover:bg-sky-100">HOMOLOGACIÓN (pruebas)</Badge>
    ) : null

  const cliente = prefill?.cliente

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (emitiendo) return
          onOpenChange(o)
        }}
      >
        <DialogContent className="sm:max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-blue-600" />
              Emitir Factura E (exportación)
              {ambienteBadge}
            </DialogTitle>
            <DialogDescription>
              Se emite en ARCA por WSFEX, punto de venta {prefill?.puntoVenta ? nroPv(prefill.puntoVenta) : '0010'}, régimen Exporta
              Simple, en dólares y sin IVA. No se carga sola en Colppy: después hay que cargarla a mano.
              {prefill && (
                <span className="block mt-1">
                  Cotización {prefill.quote.quoteNumber}
                  {prefill.quote.purchaseOrderNumber ? ` · OC ${prefill.quote.purchaseOrderNumber}` : ''}
                </span>
              )}
              {subtitle && <span className="block mt-1 text-blue-600 font-medium">{subtitle}</span>}
            </DialogDescription>
          </DialogHeader>

          {cargando && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-600">
              <Loader2 className="h-5 w-5 animate-spin" /> Cargando datos de la cotización y la cotización oficial de ARCA...
            </div>
          )}

          {!cargando && errorCarga && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
              <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-800 flex-1">
                <p className="font-semibold">No se pudo cargar la Factura E</p>
                <p className="mt-1">{errorCarga}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => cargar()}>
                <RefreshCw className="h-4 w-4 mr-1" /> Reintentar
              </Button>
            </div>
          )}

          {!cargando && prefill && cliente && (
            <div className="space-y-4">
              {/* Bloqueos (configuración, estado de la cotización, ARCA, comprobante sin resolver) */}
              {bloqueosGenerales.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                  <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-red-800">
                    <p className="font-semibold">No se puede emitir todavía</p>
                    <ul className="mt-1 list-disc pl-5 space-y-0.5">
                      {bloqueosGenerales.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* 1. Cliente (chequeo previo) */}
              <div
                className={`rounded-lg border p-4 ${
                  prefill.faltantesCliente.length ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-blue-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-blue-900">Receptor (cliente del exterior)</p>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" asChild>
                      <Link href={`/clientes/${cliente.id}`} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Editar cliente
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => cargar({ conservar: true })}
                      title="Volver a leer los datos del cliente sin perder lo cargado"
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Revisar de nuevo
                    </Button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                  <div>
                    <p className="text-xs text-gray-600">Razón social</p>
                    <p className="font-medium">{cliente.nombre || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">País destino</p>
                    <p className="font-medium">
                      {cliente.pais || '—'}
                      {cliente.dstCmp ? <span className="text-xs text-gray-500"> · código ARCA {cliente.dstCmp}</span> : null}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">{cliente.etiquetaIdFiscal} (Id impositivo)</p>
                    <p className="font-mono">{cliente.idImpositivo || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">CUIT país</p>
                    <p className="font-mono">
                      {cliente.cuitPais || '—'}{' '}
                      <span className="font-sans text-xs text-gray-500">({TIPO_PERSONA_LABEL[cliente.tipoPersona] ?? cliente.tipoPersona})</span>
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs text-gray-600">Domicilio</p>
                    <p className="font-medium">{cliente.domicilio || '—'}</p>
                  </div>
                </div>
                {prefill.faltantesCliente.length > 0 && (
                  <div className="mt-3 text-sm text-red-800">
                    <p className="font-semibold">Faltan datos del cliente para emitir:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {prefill.faltantesCliente.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs">Completalos en el cliente y tocá «Revisar de nuevo».</p>
                  </div>
                )}
                {prefill.advertenciasCliente.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs text-amber-800">
                    {prefill.advertenciasCliente.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 2. Ítems */}
              <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100 border-b">
                      <tr>
                        <th className="p-2 w-8" title="Incluir en la factura" />
                        <th className="text-left p-2 font-medium">Código</th>
                        <th className="text-left p-2 font-medium">Descripción</th>
                        <th className="text-right p-2 font-medium text-gray-500">Cotizada</th>
                        <th className="text-right p-2 font-medium text-green-700">Pendiente</th>
                        <th className="text-right p-2 font-medium">Cant. a facturar</th>
                        <th className="text-right p-2 font-medium">Precio unit. USD</th>
                        <th className="text-right p-2 font-medium">Dto %</th>
                        <th className="text-right p-2 font-medium">Subtotal USD</th>
                        <th className="p-2 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {form.filas.length === 0 && (
                        <tr>
                          <td colSpan={10} className="p-4 text-center text-gray-500">
                            La cotización no tiene ítems pendientes de facturar.
                          </td>
                        </tr>
                      )}
                      {form.filas.map((f, i) => {
                        const r = calculo.filas[i]
                        return (
                          <tr key={f.quoteItemId} className={`border-b ${f.incluido ? '' : 'opacity-50 bg-gray-50'}`}>
                            <td className="p-2 align-top pt-3">
                              <Checkbox
                                checked={f.incluido}
                                onCheckedChange={(c) => setFila(i, { incluido: c === true })}
                                aria-label={`Incluir el ítem ${f.itemNumber}`}
                              />
                            </td>
                            <td className="p-2 align-top pt-3 font-mono text-xs text-gray-600 whitespace-nowrap">
                              {f.codigo || '—'}
                            </td>
                            <td className="p-2 min-w-[260px]">
                              <Input
                                value={f.descripcion}
                                onChange={(e) => setFila(i, { descripcion: e.target.value })}
                                className="h-8 text-sm"
                                disabled={!f.incluido}
                              />
                            </td>
                            <td className="p-2 text-right font-mono text-gray-500 align-top pt-3">{f.cantidadCotizada}</td>
                            <td className="p-2 text-right font-mono text-green-700 align-top pt-3">{f.cantidadPendiente}</td>
                            <td className="p-2 w-28">
                              <Input
                                value={f.cantidad}
                                onChange={(e) => setFila(i, { cantidad: e.target.value })}
                                inputMode="decimal"
                                className={`h-8 text-sm text-right ${r?.error && f.incluido ? 'border-red-500' : ''}`}
                                disabled={!f.incluido}
                              />
                            </td>
                            <td className="p-2 w-32">
                              <Input
                                value={f.precio}
                                onChange={(e) => setFila(i, { precio: e.target.value })}
                                inputMode="decimal"
                                className="h-8 text-sm text-right"
                                disabled={!f.incluido}
                              />
                            </td>
                            <td className="p-2 text-right font-mono align-top pt-3">{f.descuentoPct ? `${f.descuentoPct}%` : '—'}</td>
                            <td className="p-2 text-right font-medium align-top pt-3 whitespace-nowrap">
                              {f.incluido ? (r?.subtotalUSD !== null && r?.subtotalUSD !== undefined ? usd(r.subtotalUSD) : '—') : '—'}
                              {f.incluido && r?.error && <p className="text-[10px] text-red-600 font-normal">{r.error}</p>}
                            </td>
                            <td />
                          </tr>
                        )
                      })}
                      {form.manuales.map((m, i) => {
                        const r = calculo.manuales[i]
                        return (
                          <tr key={`manual-${i}`} className="border-b bg-amber-50/50">
                            <td className="p-2 align-top pt-3 text-center text-amber-700" title="Línea manual: no comisiona ni integra el FOB">
                              +
                            </td>
                            <td className="p-2 align-top pt-3 text-xs text-amber-800 whitespace-nowrap">Manual</td>
                            <td className="p-2">
                              <Input
                                value={m.descripcion}
                                onChange={(e) => setManual(i, { descripcion: e.target.value })}
                                placeholder="Ej.: Flete internacional / Seguro"
                                className="h-8 text-sm"
                              />
                            </td>
                            <td className="p-2" />
                            <td className="p-2" />
                            <td className="p-2 text-right font-mono align-top pt-3">1</td>
                            <td className="p-2 w-32">
                              <Input
                                value={m.importe}
                                onChange={(e) => setManual(i, { importe: e.target.value })}
                                inputMode="decimal"
                                placeholder="0,00"
                                className={`h-8 text-sm text-right ${r?.error ? 'border-red-500' : ''}`}
                              />
                            </td>
                            <td className="p-2 text-right align-top pt-3">—</td>
                            <td className="p-2 text-right font-medium align-top pt-3 whitespace-nowrap">
                              {r?.subtotalUSD !== null && r?.subtotalUSD !== undefined ? usd(r.subtotalUSD) : '—'}
                              {r?.error && <p className="text-[10px] text-red-600 font-normal">{r.error}</p>}
                            </td>
                            <td className="p-2 align-top pt-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-red-600"
                                onClick={() => quitarManual(i)}
                                aria-label="Quitar línea manual"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-gray-50 px-3 py-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={agregarManual}
                    disabled={form.manuales.length >= MAX_LINEAS_MANUALES_FORM || !!incotermSel?.sinFlete}
                    title={incotermSel?.sinFlete ? `Con ${incotermSel.codigo} el flete lo paga el cliente` : undefined}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Agregar línea manual (flete/seguro)
                  </Button>
                  <p className="text-xs text-gray-500">
                    Precios en USD sin IVA (exportación). Las líneas manuales no comisionan ni integran el FOB del DES.
                  </p>
                </div>
              </div>

              {/* 3. Exportación */}
              <div className="rounded-lg border bg-gray-50 p-4 space-y-4">
                <p className="text-sm font-semibold text-gray-800">Exportación</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Régimen</Label>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" className="h-8 text-xs" variant="default">
                        Exporta Simple
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 text-xs"
                        variant="outline"
                        disabled
                        title="Con permiso de embarque del despachante: todavía no disponible"
                      >
                        Con despachante (próximamente)
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="fex-des">N° de DES</Label>
                    <Input
                      id="fex-des"
                      value={form.desNumero}
                      onChange={(e) => setCampo('desNumero', normalizarDesForm(e.target.value))}
                      placeholder="Tal como lo muestra el portal"
                      className="font-mono uppercase"
                      maxLength={20}
                      autoComplete="off"
                    />
                    <p className="text-xs text-gray-500">Documento de Exportación Simplificada (8 a 11 letras y números).</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="fex-fob">FOB del DES (USD)</Label>
                    <Input
                      id="fex-fob"
                      value={form.fob}
                      onChange={(e) => setCampo('fob', e.target.value)}
                      inputMode="decimal"
                      placeholder={calculo.mercaderiaUSD > 0 ? `Mercadería: ${calculo.mercaderiaUSD.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : '0,00'}
                      className={`text-right ${validacion.diferenciaFobUSD !== null && validacion.diferenciaFobUSD !== 0 ? 'border-red-500' : ''}`}
                      autoComplete="off"
                    />
                    <div className="flex flex-wrap items-center gap-x-2 text-xs">
                      {validacion.diferenciaFobUSD === 0 && calculo.seleccionados > 0 ? (
                        <span className="text-green-700 flex items-center">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Coincide con la mercadería facturada
                        </span>
                      ) : validacion.diferenciaFobUSD !== null ? (
                        <span className="text-red-700">Diferencia con la mercadería: {usd(validacion.diferenciaFobUSD)}</span>
                      ) : (
                        <span className="text-gray-500">Mercadería facturada: {usd(calculo.mercaderiaUSD)}</span>
                      )}
                      {calculo.mercaderiaUSD > 0 && validacion.diferenciaFobUSD !== 0 && (
                        <button
                          type="button"
                          className="text-blue-600 hover:underline"
                          onClick={() => setCampo('fob', calculo.mercaderiaUSD.toFixed(2))}
                        >
                          Usar {usd(calculo.mercaderiaUSD)}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 text-blue-600" />
                  <span>
                    Generá primero el DES en el portal de Exporta Simple con el <b>mismo FOB, al centavo</b>, y copiá acá su número.
                    Si cambian cantidades o precios, corregí el DES antes de emitir: ARCA rechaza si no coinciden.
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="fex-incoterm">Incoterm</Label>
                    <Select value={form.incoterm} onValueChange={(v) => setCampo('incoterm', v)}>
                      <SelectTrigger id="fex-incoterm">
                        <SelectValue placeholder="Elegí el Incoterm" />
                      </SelectTrigger>
                      <SelectContent>
                        {incoterms.map((i) => (
                          <SelectItem key={i.codigo} value={i.codigo}>
                            {i.codigo} — {i.descripcion}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {incotermSel?.sinFlete && (
                      <p className="text-xs text-amber-700">
                        Con {incotermSel.codigo} el flete lo paga el cliente: la factura no lleva línea de flete y el total es igual al FOB.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="fex-lugar">Lugar del Incoterm</Label>
                    <Input
                      id="fex-lugar"
                      value={form.incotermLugar}
                      onChange={(e) => setCampo('incotermLugar', e.target.value)}
                      placeholder="Ej.: Santiago"
                      maxLength={MAX_INCOTERM_LUGAR}
                    />
                    <p className="text-xs text-gray-500">
                      Hasta {MAX_INCOTERM_LUGAR} caracteres ({form.incotermLugar.trim().length}/{MAX_INCOTERM_LUGAR}).
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="fex-forma-pago">Forma de pago</Label>
                    <Input
                      id="fex-forma-pago"
                      value={form.formaPago}
                      onChange={(e) => setCampo('formaPago', e.target.value)}
                      placeholder="Ej.: Transferencia anticipada 100%"
                      maxLength={MAX_FORMA_PAGO}
                    />
                    <p className="text-xs text-gray-500">
                      Sale impresa en la factura ({form.formaPago.trim().length}/{MAX_FORMA_PAGO}).
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>País destino</Label>
                    <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                      {cliente.pais || '—'}
                      {cliente.dstCmp ? ` (${cliente.dstCmp})` : ''}
                    </div>
                    <p className="text-xs text-gray-500">Sale del país del cliente.</p>
                  </div>

                  <div className="space-y-2">
                    <Label>Idioma</Label>
                    <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">Español</div>
                  </div>

                  <div className="space-y-2 md:col-span-3">
                    <Label htmlFor="fex-obs">Observaciones comerciales (opcional)</Label>
                    <Textarea
                      id="fex-obs"
                      value={form.obsComerciales}
                      onChange={(e) => setCampo('obsComerciales', e.target.value)}
                      rows={2}
                      maxLength={MAX_OBS_COMERCIALES}
                      placeholder="Ej.: OC del cliente, condiciones de entrega"
                    />
                  </div>
                </div>
              </div>

              {/* 4. Moneda y 5. Resumen */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border p-4 space-y-2 text-sm">
                  <p className="font-semibold text-gray-800">Moneda</p>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Moneda de la factura</span>
                    <span className="font-medium">USD — Dólar estadounidense</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-600">Cotización oficial ARCA (DOL)</span>
                    <span className="font-medium text-right">
                      {cotizacion ? (
                        <>
                          {ars(cotizacion.cotizacion)}
                          <span className="block text-xs text-gray-500 font-normal">
                            del {formatearFechaArca(cotizacion.fechaCotizacion)}
                            {cotizacion.diasAtras > 0
                              ? ` (consultada con fecha ${formatearFechaArca(cotizacion.fechaConsultada)}: ARCA no tenía la de hoy)`
                              : ''}
                          </span>
                        </>
                      ) : (
                        <span className="text-red-700">Sin cotización</span>
                      )}
                    </span>
                  </div>
                  {prefill.cotizacionError && <p className="text-xs text-red-700">{prefill.cotizacionError}</p>}
                  <label className="flex items-start gap-2 pt-2 border-t cursor-pointer">
                    <Checkbox
                      checked={form.cancelaEnMonedaExtranjera}
                      onCheckedChange={(c) => setCampo('cancelaEnMonedaExtranjera', c === true)}
                      className="mt-0.5"
                    />
                    <span>
                      El cliente paga en dólares <span className="text-xs text-gray-500">(CanMisMonExt = S)</span>
                      <span className="block text-xs text-gray-500">
                        Destildalo solo si la factura se cancela en pesos. Con la tilde, ARCA exige su cotización oficial (la de arriba).
                      </span>
                    </span>
                  </label>
                </div>

                <div className="rounded-lg border bg-gray-50 p-4 space-y-2 text-sm">
                  <p className="font-semibold text-gray-800">Resumen</p>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Mercadería ({calculo.seleccionados} ítem{calculo.seleccionados === 1 ? '' : 's'})</span>
                    <span>{usd(calculo.mercaderiaUSD)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Flete / seguro (manual)</span>
                    <span>{usd(calculo.manualUSD)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="font-semibold text-base">Total Factura E</span>
                    <span className="font-semibold text-base">{usd(calculo.totalUSD)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">FOB del DES</span>
                    <span>{Number.isFinite(validacion.fobUSD) ? usd(validacion.fobUSD) : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Diferencia total − FOB (flete/seguro)</span>
                    <span>{Number.isFinite(validacion.fobUSD) ? usd(Math.round((calculo.totalUSD - validacion.fobUSD) * 100) / 100) : '—'}</span>
                  </div>
                  {cotizacion && (
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Equivalente en pesos (informativo)</span>
                      <span>{ars(Math.round(calculo.totalUSD * cotizacion.cotizacion * 100) / 100)}</span>
                    </div>
                  )}
                  <p className="text-xs text-gray-500">Comisiona solo la mercadería: {usd(calculo.mercaderiaUSD)}.</p>
                </div>
              </div>

              {/* Validación previa */}
              {validacion.errores.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <p className="font-semibold">Para emitir falta corregir:</p>
                  <ul className="mt-1 list-disc pl-5 space-y-0.5">
                    {validacion.errores.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {validacion.avisos.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <ul className="list-disc pl-5 space-y-0.5">
                    {validacion.avisos.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Respuesta del servidor / ARCA */}
              {erroresServidor && (
                <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3">
                  <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-red-800">
                    <p className="font-semibold">{erroresServidor.titulo}</p>
                    <ul className="mt-1 list-disc pl-5 space-y-0.5 break-words">
                      {erroresServidor.lineas.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Vista previa (dryRun) */}
              {vista && (
                <VistaPreviaPanel
                  vista={vista.data}
                  vigente={vistaVigente}
                  onCerrar={() => setVista(null)}
                  onCopiar={copiar}
                />
              )}

              {/* Advertencia */}
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-amber-900">Operación irreversible</p>
                  <p className="text-amber-700 mt-1">
                    Emite la Factura E en ARCA{prefill.ambiente === 'prod' ? ' (PRODUCCIÓN)' : ''}, punto de venta{' '}
                    {nroPv(prefill.puntoVenta)}. Para anularla hace falta una nota de crédito E, que además mueve el saldo del DES
                    (todavía no disponible en el ERP). No se carga en Colppy: hay que cargarla a mano y pegar el id en la factura.
                  </p>
                </div>
              </div>

              {/* Confirmación */}
              {confirmando && (
                <div className="rounded-lg border-2 border-blue-500 bg-blue-50 p-4 space-y-3 text-sm">
                  <p className="font-semibold text-blue-900">
                    Confirmá la emisión{prefill.ambiente === 'prod' ? ' en PRODUCCIÓN' : ' en HOMOLOGACIÓN'}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-blue-900">
                    <span>Cliente: <b>{cliente.nombre}</b> ({cliente.pais})</span>
                    <span>Total: <b>{usd(calculo.totalUSD)}</b> (mercadería {usd(calculo.mercaderiaUSD)}, flete/seguro {usd(calculo.manualUSD)})</span>
                    <span>DES: <b className="font-mono">{desNormalizado}</b> · FOB <b>{usd(validacion.fobUSD)}</b></span>
                    <span>Incoterm: <b>{form.incoterm}</b> {form.incotermLugar.trim()} · Pago: {form.formaPago.trim()}</span>
                    <span>
                      TC ARCA: <b>{cotizacion ? ars(cotizacion.cotizacion) : '—'}</b> · {form.cancelaEnMonedaExtranjera ? 'paga en dólares' : 'paga en pesos'}
                    </span>
                    <span>Punto de venta {nroPv(prefill.puntoVenta)} · Factura E (19)</span>
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer rounded bg-white border border-blue-200 p-2">
                    <Checkbox checked={verificado} onCheckedChange={(c) => setVerificado(c === true)} className="mt-0.5" />
                    <span>
                      Verifiqué en el portal de Exporta Simple que el DES <b className="font-mono">{desNormalizado}</b> está generado con FOB{' '}
                      <b>{usd(validacion.fobUSD)}</b> para este cliente.
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={emitiendo}>
              {confirmando ? 'Cerrar' : 'Cancelar'}
            </Button>
            {prefill && !cargando && (
              <Button
                type="button"
                variant="outline"
                onClick={pedirVistaPrevia}
                disabled={!listo || cargandoVista || emitiendo}
                title={!listo ? 'Corregí lo marcado en rojo para ver la vista previa' : 'Arma el request exacto sin emitir'}
              >
                {cargandoVista ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
                Vista previa
              </Button>
            )}
            {prefill && !cargando && !confirmando && (
              <Button
                type="button"
                className="bg-blue-600 hover:bg-blue-700"
                onClick={() => {
                  setVerificado(false)
                  setConfirmando(true)
                }}
                disabled={!puedeEmitir}
                title={
                  frenado
                    ? 'Hay una emisión sin resolver: no se puede volver a emitir desde acá'
                    : !listo
                      ? 'Corregí lo marcado en rojo'
                      : undefined
                }
              >
                <Globe className="h-4 w-4 mr-2" />
                Emitir Factura E
              </Button>
            )}
            {prefill && !cargando && confirmando && (
              <>
                <Button type="button" variant="outline" onClick={() => setConfirmando(false)} disabled={emitiendo}>
                  Volver
                </Button>
                <Button
                  type="button"
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={emitir}
                  disabled={!puedeEmitir || !verificado}
                  title={!verificado ? 'Tildá la verificación del DES' : undefined}
                >
                  {emitiendo ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Emitiendo en ARCA...
                    </>
                  ) : (
                    <>
                      <Globe className="h-4 w-4 mr-2" />
                      Confirmar y emitir
                    </>
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resultado incierto / huérfano / sin respuesta: bloqueante, NO se cierra
          clickeando afuera ni con ESC. El usuario tiene que leerlo. */}
      <Dialog
        open={!!bloqueante}
        onOpenChange={(o) => {
          if (!o) return
        }}
      >
        <DialogContent
          className="sm:max-w-lg border-2 border-red-500"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-6 w-6" />
              {bloqueante?.tipo === 'HUERFANA'
                ? 'Factura E emitida pero no registrada en el ERP'
                : bloqueante?.tipo === 'INCIERTA'
                  ? 'ARCA no confirmó la Factura E'
                  : 'No se sabe si la Factura E se emitió'}
            </DialogTitle>
            <DialogDescription className="text-gray-900 pt-2">{bloqueante?.mensaje}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {bloqueante?.numero && (
              <div className="rounded-md border-2 border-red-300 bg-red-50 p-3">
                <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">Número de la Factura E</p>
                <div className="flex items-center justify-between mt-1 gap-2">
                  <code className="text-lg font-mono font-bold text-red-900 select-all break-all">{bloqueante.numero}</code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copiar(bloqueante.numero!, 'Número')}
                    className="flex-shrink-0 border-red-300 text-red-700 hover:bg-red-100"
                  >
                    Copiar
                  </Button>
                </div>
                {bloqueante.cae && <p className="mt-1 text-sm text-red-900">CAE {bloqueante.cae}</p>}
              </div>
            )}
            {bloqueante?.fexId !== undefined && (
              <p className="text-xs text-gray-600">
                Id del comprobante en ARCA (Cmp.Id): <code className="font-mono">{bloqueante.fexId}</code>
              </p>
            )}
            <p className="text-sm font-semibold text-red-800">
              No vuelvas a emitir: un nuevo intento podría facturar dos veces la misma venta. Se resuelve con
              scripts/arca-fex-reconciliar.ts, que reenvía el mismo Id o recupera el CAE.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                // No se vuelve a emitir desde acá: se cierra y se refresca lo de atrás
                setBloqueante(null)
                onOpenChange(false)
                onEmitted?.(null)
              }}
              className="bg-red-600 hover:bg-red-700 text-white w-full"
            >
              Entendido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ============================================================================
// VISTA PREVIA (dryRun)
// ============================================================================

function VistaPreviaPanel({
  vista,
  vigente,
  onCerrar,
  onCopiar,
}: {
  vista: VistaPreviaFacturaExportacion
  vigente: boolean
  onCerrar: () => void
  onCopiar: (texto: string, que: string) => void
}) {
  const cmp = vista.cmp
  const xml = useMemo(() => indentarXml(vista.xml), [vista.xml])
  const filas: Array<[string, React.ReactNode]> = [
    ['Comprobante', `Factura E (${cmp.Cbte_Tipo}) ${vista.numeroFormateado} · interno ${vista.numeroInterno}`],
    ['Id (Cmp.Id)', String(vista.fexId)],
    ['Fecha', formatearFechaArca(cmp.Fecha_cbte)],
    ['Tipo de exportación / Permiso', `${cmp.Tipo_expo} / ${cmp.Permiso_existente || '(vacío)'}`],
    ['Cliente', cmp.Cliente],
    ['Domicilio', cmp.Domicilio_cliente],
    ['Destino / CUIT país / Id impositivo', `${cmp.Dst_cmp} / ${cmp.Cuit_pais_cliente || '—'} / ${cmp.Id_impositivo || '—'}`],
    ['Moneda / Cotización / Paga en la moneda', `${cmp.Moneda_Id} / ${cmp.Moneda_ctz} / ${cmp.CanMisMonExt ?? '—'}`],
    ['Importe total', `USD ${cmp.Imp_total}`],
    ['Forma de pago', cmp.Forma_pago ?? '—'],
    ['Incoterm', `${cmp.Incoterms ?? '—'} ${cmp.Incoterms_Ds ?? ''}`.trim()],
    ['Opcionales', (cmp.Opcionales ?? []).map((o) => `${o.Id} = ${o.Valor}`).join(' · ') || '—'],
    ['Observaciones comerciales', cmp.Obs_comerciales || '—'],
  ]

  return (
    <div className={`rounded-lg border-2 p-4 space-y-3 ${vigente ? 'border-sky-400 bg-sky-50/40' : 'border-gray-300 bg-gray-50'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sky-900">Vista previa del request a ARCA (no se emitió nada)</p>
          <p className="text-xs text-gray-600">
            El número y el Id son los que corresponderían ahora; al emitir se vuelven a pedir a ARCA. Revisalo contra el DES del portal.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onCerrar}>
          Cerrar
        </Button>
      </div>
      {!vigente && (
        <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
          Cambiaste datos después de generarla: está desactualizada. Volvé a tocar «Vista previa».
        </p>
      )}
      {vista.advertencias.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-amber-800">
          {vista.advertencias.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-sm">
        {filas.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-dashed border-gray-200 py-0.5">
            <span className="text-gray-600">{k}</span>
            <span className="text-right font-medium break-words">{v}</span>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-1.5 text-left">Código</th>
              <th className="p-1.5 text-left">Descripción</th>
              <th className="p-1.5 text-right">Cant.</th>
              <th className="p-1.5 text-right">UMed</th>
              <th className="p-1.5 text-right">Precio</th>
              <th className="p-1.5 text-right">Bonif.</th>
              <th className="p-1.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {cmp.Items.map((it, i) => (
              <tr key={i} className="border-t">
                <td className="p-1.5 font-mono">{it.Pro_codigo || '—'}</td>
                <td className="p-1.5">{it.Pro_ds}</td>
                <td className="p-1.5 text-right">{it.Pro_qty}</td>
                <td className="p-1.5 text-right">{it.Pro_umed}</td>
                <td className="p-1.5 text-right">{it.Pro_precio_uni}</td>
                <td className="p-1.5 text-right">{it.Pro_bonificacion}</td>
                <td className="p-1.5 text-right font-medium">{it.Pro_total_item}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="rounded border bg-white">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-700">
          XML completo de FEXAuthorize (Token y Sign ocultos)
        </summary>
        <div className="border-t p-2">
          <div className="mb-2 flex gap-2">
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => onCopiar(xml, 'XML')}>
              <Copy className="h-3 w-3 mr-1" /> Copiar XML
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onCopiar(JSON.stringify(cmp, null, 2), 'Cmp (JSON)')}
            >
              <Copy className="h-3 w-3 mr-1" /> Copiar Cmp (JSON)
            </Button>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre text-[11px] leading-snug text-gray-800">{xml}</pre>
        </div>
      </details>
    </div>
  )
}

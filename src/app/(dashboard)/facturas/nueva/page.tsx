'use client'

/**
 * Nueva factura (factura directa, sin cotización): Factura A, B o FCE A que
 * emite el ERP en ARCA (PV 7) y después registra en Colppy. Pedido de Santiago
 * (5/10/2026) para dejar de depender de Colppy para facturar.
 *
 * Estados: edición → vista previa (sin efectos; cualquier edición la
 * invalida) → confirmaciones → emitiendo → éxito (navega a la factura y abre el
 * PDF) o error. La clave de idempotencia se genera cuando la vista previa sale
 * bien; un error de red o "ARCA no solicitado" se reintenta con LA MISMA clave
 * (si ya se emitió, el servidor devuelve esa factura); un 422 obliga a otra
 * vista previa (otra clave). ARCA_INCIERTO y ERP_HUERFANA abren un diálogo
 * bloqueante: NO se reintenta.
 *
 * Deep links: ?cliente=<id> y ?mlVenta=<pack u orden>.
 * Servidor: src/lib/facturacion/factura-directa.ts. Lógica del cliente:
 * src/lib/facturacion/factura-directa-ui.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency } from '@/lib/utils'
import { letraFacturaColppy } from '@/lib/facturacion/letra-factura'
import { MAX_OBSERVACIONES_FACTURA_DIRECTA } from '@/lib/facturacion/factura-directa-form'
import type { PendienteFacturaDirecta, PreviewFacturaDirecta } from '@/lib/facturacion/factura-directa'
import type { InspeccionVentaMl } from '@/lib/mercadolibre/venta-ml-vinculo'
import {
  ESTADO_EMISION_INICIAL,
  armarPedidoFacturaDirecta,
  avisosResultadoEmision,
  cambiaSignificadoPrecios,
  clasificarRespuestaEmision,
  cuerpoEmisionFacturaDirecta,
  estadoTrasEmision,
  etiquetaComprobante,
  firmaPedidoFacturaDirecta,
  formInicial,
  formParaCliente,
  invalidarVistaPrevia,
  lineaEnBlanco,
  lineasDesdeVentaMl,
  notaRedondeoPreciosConIva,
  nuevaClaveIdempotencia,
  numeroATexto,
  problemasDeError,
  puedeEmitirFacturaDirecta,
  puedeFacturaDirecta,
  reintentoConConfirmacionesVigentes,
  tipoCambioDesdeApi,
  validarFormularioFacturaDirecta,
  type ClienteFacturaDirecta,
  type CuerpoEmisionFacturaDirecta,
  type EstadoEmisionUi,
  type FormFacturaDirecta,
  type ResultadoEmisionDirecta,
} from '@/lib/facturacion/factura-directa-ui'
import { ClienteFacturaPicker } from '@/components/facturacion/nueva/ClienteFacturaPicker'
import { CondicionesFactura } from '@/components/facturacion/nueva/CondicionesFactura'
import { LineasFacturaEditor } from '@/components/facturacion/nueva/LineasFacturaEditor'
import { VentaMlVinculo } from '@/components/facturacion/nueva/VentaMlVinculo'
import { ResumenEmision } from '@/components/facturacion/nueva/ResumenEmision'
import { EmisionBloqueadaDialog } from '@/components/facturacion/nueva/EmisionBloqueadaDialog'
import { cargarClienteFactura } from '@/components/facturacion/nueva/cliente-api'

export default function NuevaFacturaPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session, status: sessionStatus } = useSession()
  const permitido = puedeFacturaDirecta(session?.user?.role)

  const uidRef = useRef(0)
  const nuevoUid = useCallback(() => `l${++uidRef.current}`, [])

  const [cliente, setCliente] = useState<ClienteFacturaDirecta | null>(null)
  const [form, setForm] = useState<FormFacturaDirecta>(() => formInicial('l0'))
  const [estado, setEstado] = useState<EstadoEmisionUi>(ESTADO_EMISION_INICIAL)
  const [cargandoVista, setCargandoVista] = useState(false)
  // Después de pedir la vista previa también se marcan las filas vacías
  const [intentoVista, setIntentoVista] = useState(false)
  const [emitiendo, setEmitiendo] = useState(false)
  const [pendientes, setPendientes] = useState<PendienteFacturaDirecta[]>([])
  const [tcReferencia, setTcReferencia] = useState<{ rate: number; fecha: string | null } | null>(null)
  const [cargandoTc, setCargandoTc] = useState(false)
  const [mlInicial] = useState(() => (searchParams.get('mlVenta') ?? '').replace(/\D/g, ''))

  // Mientras se emite, se reintenta o quedó frenada, el formulario no se toca
  const bloqueado = emitiendo || !!estado.reintento || estado.frenada

  // --------------------------------------------------------------------------
  // Derivados
  // --------------------------------------------------------------------------

  const letra = cliente ? letraFacturaColppy(cliente.taxCondition) : null
  const preciosFinales = letra === 'B' || form.preciosConIva
  const validacion = useMemo(() => validarFormularioFacturaDirecta(cliente, form), [cliente, form])
  const pedido = useMemo(() => (cliente ? armarPedidoFacturaDirecta(cliente, form) : null), [cliente, form])
  const firma = useMemo(() => (pedido ? firmaPedidoFacturaDirecta(pedido) : ''), [pedido])
  const vigente = !!estado.vista && estado.vista.firma === firma
  const emision = puedeEmitirFacturaDirecta(estado.vista, firma, estado.tildadas)
  const calculo = validacion.calculo
  const clienteBloqueado = validacion.errores.some((e) => e.codigo === 'CLIENTE_EXTERIOR' || e.codigo === 'CONDICION_NO_SOPORTADA')
  const vistaHabilitada = !cliente
    ? { puede: false, motivo: 'Elegí el cliente' }
    : clienteBloqueado
      ? { puede: false, motivo: 'Este cliente no se factura desde acá' }
      : { puede: true, motivo: null }
  const erroresGenerales = validacion.errores.filter((e) => !e.linea && e.codigo !== 'SIN_CLIENTE' && e.codigo !== 'CLIENTE_EXTERIOR' && e.codigo !== 'CONDICION_NO_SOPORTADA')
  const notaRedondeo = calculo && pedido ? notaRedondeoPreciosConIva(letra, pedido.preciosConIva, pedido.lineas, calculo.totales.total) : null

  // --------------------------------------------------------------------------
  // Edición (cualquier cambio invalida la vista previa y su clave)
  // --------------------------------------------------------------------------

  const actualizar = useCallback((fn: (f: FormFacturaDirecta) => FormFacturaDirecta) => {
    setForm(fn)
    setEstado((e) => ({ ...e, vista: invalidarVistaPrevia(e.vista), tildadas: [], error: null }))
  }, [])
  const setCampo = useCallback(
    <K extends keyof FormFacturaDirecta>(k: K, v: FormFacturaDirecta[K]) => actualizar((f) => ({ ...f, [k]: v })),
    [actualizar]
  )
  const setMlVenta = useCallback((v: string) => setCampo('mlVenta', v), [setCampo])

  const elegirCliente = (c: ClienteFacturaDirecta | null) => {
    const antes = { letra, preciosConIva: form.preciosConIva }
    setCliente(c)
    if (!c) {
      actualizar((f) => f)
      return
    }
    const nuevo = formParaCliente(form, c)
    const despues = { letra: letraFacturaColppy(c.taxCondition), preciosConIva: nuevo.preciosConIva }
    if (form.lineas.some((l) => !lineaEnBlanco(l)) && cambiaSignificadoPrecios(antes, despues)) {
      toast.warning(`Ahora es ${etiquetaComprobante(despues.letra)}: revisá los precios`, {
        description: despues.letra === 'B' || despues.preciosConIva ? 'Los precios cargados se toman como finales (con IVA).' : 'Los precios cargados se toman como netos (sin IVA).',
        duration: 10000,
      })
    }
    actualizar(() => nuevo)
  }

  const precargarVentaMl = (v: InspeccionVentaMl) => {
    if (form.lineas.some((l) => !lineaEnBlanco(l)) && !window.confirm('¿Reemplazar las líneas cargadas por las de la venta de Mercado Libre?')) return
    if (letra === 'A' && !form.preciosConIva) toast.info('Se activó "Precios con IVA incluido": los precios de Mercado Libre son finales')
    actualizar((f) => ({ ...f, lineas: lineasDesdeVentaMl(v, nuevoUid), preciosConIva: true }))
  }

  // --------------------------------------------------------------------------
  // Carga inicial: pendientes, deep links y tipo de cambio
  // --------------------------------------------------------------------------

  const cargarPendientes = useCallback(async () => {
    try {
      const r = await fetch('/api/facturas/directa/pendientes')
      if (!r.ok) return
      const d = await r.json()
      setPendientes(Array.isArray(d.pendientes) ? d.pendientes : [])
    } catch {
      // El banner es informativo: el servidor igual bloquea la emisión
    }
  }, [])

  useEffect(() => {
    if (permitido) cargarPendientes()
  }, [permitido, cargarPendientes])

  const clienteInicial = useRef(searchParams.get('cliente'))
  useEffect(() => {
    const id = clienteInicial.current
    if (!permitido || !id) return
    clienteInicial.current = null
    cargarClienteFactura(id)
      .then((c) => {
        setCliente(c)
        setForm((f) => formParaCliente(f, c))
      })
      .catch((e) => toast.error('No se pudo cargar el cliente del link', { description: (e as Error).message }))
  }, [permitido])

  useEffect(() => {
    if (mlInicial) setForm((f) => ({ ...f, mlVenta: mlInicial }))
  }, [mlInicial])

  const cargarTipoCambio = useCallback(
    async (forzar: boolean) => {
      setCargandoTc(true)
      try {
        const r = await fetch('/api/tipo-cambio?from=USD&to=ARS')
        const ref = tipoCambioDesdeApi(await r.json().catch(() => null))
        setTcReferencia(ref)
        if (!ref) {
          if (forzar) toast.warning('No hay un dólar BNA cargado: ingresá el tipo de cambio a mano')
          return
        }
        if (forzar) setCampo('tipoCambio', numeroATexto(ref.rate))
        else setForm((f) => (f.tipoCambio.trim() ? f : { ...f, tipoCambio: numeroATexto(ref.rate) }))
      } catch (e) {
        toast.error('No se pudo leer el tipo de cambio', { description: (e as Error).message })
      } finally {
        setCargandoTc(false)
      }
    },
    [setCampo]
  )

  const tcPedido = useRef(false)
  useEffect(() => {
    if (form.moneda === 'USD' && !tcPedido.current) {
      tcPedido.current = true
      cargarTipoCambio(false)
    }
  }, [form.moneda, cargarTipoCambio])

  // No cerrar la pestaña mientras se emite
  useEffect(() => {
    if (!emitiendo) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [emitiendo])

  // --------------------------------------------------------------------------
  // Vista previa y emisión
  // --------------------------------------------------------------------------

  const pedirVistaPrevia = async () => {
    setIntentoVista(true)
    if (!cliente || !pedido) return
    if (validacion.errores.length) {
      toast.error('Corregí lo marcado en rojo antes de la vista previa')
      return
    }
    const firmaPedida = firma
    setCargandoVista(true)
    setEstado((e) => ({ ...e, error: null }))
    try {
      const r = await fetch('/api/facturas/directa/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pedido),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d) {
        setEstado((e) => ({ ...e, vista: null, tildadas: [], error: { titulo: 'No se pudo armar la vista previa', problemas: problemasDeError(d, r.status) } }))
        return
      }
      const data = d as PreviewFacturaDirecta
      // La clave se genera cuando la vista previa sale bien
      setEstado((e) => ({ ...e, vista: { data, firma: firmaPedida, clave: data.ok ? nuevaClaveIdempotencia() : null }, tildadas: [], error: null }))
      if (data.errores.some((x) => x.codigo === 'EMISION_PENDIENTE')) cargarPendientes()
      // El cliente cambió en otra pantalla (condición, FCE, CUIT): se toma el del servidor
      if (data.cliente && (data.cliente.taxCondition !== cliente.taxCondition || data.cliente.fceObligado !== cliente.fceObligado || data.cliente.cuit !== cliente.cuit)) {
        toast.warning('El cliente cambió desde que lo elegiste: revisá la vista previa', { duration: 10000 })
        setCliente({ ...cliente, taxCondition: data.cliente.taxCondition, fceObligado: data.cliente.fceObligado, cuit: data.cliente.cuit })
      }
    } catch (e) {
      toast.error('No se pudo armar la vista previa', { description: (e as Error).message })
    } finally {
      setCargandoVista(false)
    }
  }

  const despuesDeEmitir = (res: ResultadoEmisionDirecta, cuerpo: CuerpoEmisionFacturaDirecta) => {
    setEstado((e) => estadoTrasEmision(e, res, cuerpo))
    if (res.tipo === 'emitida') {
      const f = res.factura
      for (const a of avisosResultadoEmision(f)) {
        const opts = {
          description: a.descripcion,
          duration: a.nivel === 'success' ? 15000 : 20000,
          ...(a.nivel === 'success' && f.pdfUrl ? { action: { label: 'Ver PDF', onClick: () => window.open(f.pdfUrl, '_blank') } } : {}),
        }
        if (a.nivel === 'success') toast.success(a.titulo, opts)
        else if (a.nivel === 'warning') toast.warning(a.titulo, opts)
        else toast.info(a.titulo, opts)
      }
      // Sin abrir el PDF solo: después de esperar a ARCA/Colppy/ML el navegador
      // ya no lo toma como parte del click y bloquea la ventana. Queda el
      // botón "Ver PDF" del aviso y los de la factura.
      router.push(`/facturas/${f.invoiceId}`)
      return
    }
    if (res.tipo === 'bloqueada') {
      toast.error(res.bloqueo.tipo === 'HUERFANA' ? 'Factura emitida pero no registrada: NO reintentes' : 'ARCA no confirmó la factura: NO reintentes', { duration: Infinity })
      cargarPendientes()
      return
    }
    // Una emisión en curso que no termina queda TRABADA en el banner de pendientes
    if ((res.tipo === 'error' && res.refrescarPendientes) || (res.tipo === 'reintentar' && res.codigo === 'EN_CURSO')) cargarPendientes()
    if (res.tipo === 'confirmar') toast.warning('Hay que confirmar algo más antes de emitir', { description: res.mensaje, duration: 15000 })
  }

  // Un solo POST de emisión a la vez (un doble click no manda dos)
  const enVuelo = useRef(false)

  const enviar = async (cuerpo: CuerpoEmisionFacturaDirecta) => {
    if (enVuelo.current) return
    enVuelo.current = true
    setEmitiendo(true)
    setEstado((e) => ({ ...e, error: null }))
    let res: ResultadoEmisionDirecta
    try {
      const r = await fetch('/api/facturas/directa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      })
      res = clasificarRespuestaEmision({ status: r.status, body: await r.json().catch(() => null) })
    } catch (e) {
      res = clasificarRespuestaEmision({ errorRed: (e as Error).message })
    } finally {
      enVuelo.current = false
      setEmitiendo(false)
    }
    despuesDeEmitir(res, cuerpo)
  }

  const emitir = () => {
    const v = estado.vista
    if (!pedido || !v?.clave || !emision.puede || bloqueado) return
    enviar(cuerpoEmisionFacturaDirecta(pedido, v.clave, v.data.confirmacionesRequeridas, estado.tildadas))
  }

  const reintentar = () => {
    if (!estado.reintento || emitiendo) return
    // El reintento manda el mismo cuerpo: si se destildó una confirmación, no se manda
    if (!reintentoConConfirmacionesVigentes(estado.reintento.cuerpo, estado.tildadas)) {
      toast.error('Cambiaron las confirmaciones: usá «Volver a editar» y pedí la vista previa de nuevo')
      return
    }
    enviar(estado.reintento.cuerpo)
  }

  const descartarReintento = () => setEstado((e) => ({ ...e, reintento: null, vista: invalidarVistaPrevia(e.vista), tildadas: [] }))

  // `firma` = ConfirmacionRequerida.firma; con un reintento pendiente no se cambian (el reintento manda las ya enviadas)
  const tildar = (firma: string, si: boolean) =>
    setEstado((e) => (e.reintento ? e : { ...e, tildadas: si ? Array.from(new Set([...e.tildadas, firma])) : e.tildadas.filter((c) => c !== firma) }))

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  if (sessionStatus === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!permitido) {
    return (
      <Card className="mx-auto mt-8 max-w-lg">
        <CardContent className="space-y-4 py-10 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-gray-400" />
          <p className="text-gray-700">Las facturas directas las emiten administración, gerencia o contaduría.</p>
          <Button asChild variant="outline">
            <Link href="/facturas">Volver a Facturas</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const moneda = form.moneda
  const totales = calculo?.totales ?? null

  return (
    <div className="space-y-6 pb-40">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/facturas" aria-label="Volver a Facturas">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nueva factura</h1>
          <p className="text-muted-foreground">Factura A, B o FCE A emitida por el ERP en ARCA, sin cotización. Después se registra en Colppy.</p>
        </div>
      </div>

      {/* Facturas directas sin resolver */}
      {pendientes.length > 0 && (
        <div className="space-y-2 rounded-lg border-2 border-red-400 bg-red-50 p-4 text-sm text-red-900">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5" />
            {pendientes.length === 1 ? 'Hay una factura directa sin resolver' : `Hay ${pendientes.length} facturas directas sin resolver`}
          </p>
          <ul className="list-disc space-y-1 pl-6">
            {pendientes.map((p) => (
              <li key={p.id}>
                {p.mensaje}{' '}
                <span className="text-xs text-red-700">
                  ({new Date(p.createdAt).toLocaleString('es-AR')} · {p.currency} {Number(p.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })} · id {p.id})
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs">A esos clientes no se les puede emitir otra factura directa hasta resolverlas. Avisá a soporte.</p>
        </div>
      )}

      <fieldset disabled={bloqueado} className="min-w-0 space-y-6">
        {/* Cliente */}
        <Card>
          <CardHeader>
            <CardTitle>Cliente</CardTitle>
            <CardDescription>La letra sale de la condición frente al IVA del cliente: no se elige a mano.</CardDescription>
          </CardHeader>
          <CardContent>
            <ClienteFacturaPicker cliente={cliente} onChange={elegirCliente} disabled={bloqueado} />
          </CardContent>
        </Card>

        {cliente && !clienteBloqueado && (
          <>
            {/* Condiciones */}
            <Card>
              <CardHeader>
                <CardTitle>Condiciones</CardTitle>
                <CardDescription>Fecha de hoy. Concepto: productos.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <CondicionesFactura
                  form={form}
                  onCampo={setCampo}
                  cliente={cliente}
                  letra={letra}
                  tcReferencia={tcReferencia}
                  cargandoTc={cargandoTc}
                  onRecargarTc={() => cargarTipoCambio(true)}
                  disabled={bloqueado}
                />
                <div className="space-y-1 border-t pt-4">
                  <Label>Venta de Mercado Libre (opcional)</Label>
                  <VentaMlVinculo
                    mlVenta={form.mlVenta}
                    onMlVenta={setMlVenta}
                    moneda={moneda}
                    onPrecargar={precargarVentaMl}
                    buscarAlInicio={!!mlInicial}
                    disabled={bloqueado}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Líneas */}
            <Card>
              <CardHeader>
                <CardTitle>Líneas</CardTitle>
                <CardDescription>
                  {preciosFinales
                    ? 'Precios finales, con IVA incluido. Cargá precios ya bonificados.'
                    : 'Precios netos, sin IVA (se suma el 21%). Cargá precios ya bonificados.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LineasFacturaEditor
                  lineas={form.lineas}
                  onChange={(lineas) => setCampo('lineas', lineas)}
                  preciosFinales={preciosFinales}
                  moneda={moneda}
                  errores={validacion.errores}
                  mostrarErroresEnBlanco={intentoVista}
                  nuevoUid={nuevoUid}
                  disabled={bloqueado}
                />
              </CardContent>
            </Card>

            {/* Observaciones */}
            <Card>
              <CardHeader>
                <CardTitle>Observaciones</CardTitle>
                <CardDescription>Quedan en la factura del ERP (no van a ARCA).</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={form.observaciones}
                  onChange={(e) => setCampo('observaciones', e.target.value)}
                  maxLength={MAX_OBSERVACIONES_FACTURA_DIRECTA}
                  rows={3}
                  placeholder="Ej.: OC 4500012345"
                  disabled={bloqueado}
                />
                <p className="mt-1 text-right text-[11px] text-muted-foreground">
                  {form.observaciones.length}/{MAX_OBSERVACIONES_FACTURA_DIRECTA}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </fieldset>

      {cliente && !clienteBloqueado && (
        <Card>
          <CardHeader>
            <CardTitle>Vista previa y emisión</CardTitle>
            <CardDescription>La vista previa controla todo (padrón de ARCA, productos, duplicados, Mercado Libre) sin emitir nada.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {erroresGenerales.length > 0 && (
              <ul className="space-y-1 text-sm text-red-700">
                {erroresGenerales.map((e, i) => (
                  <li key={i}>{e.mensaje}</li>
                ))}
              </ul>
            )}
            {validacion.avisos.length > 0 && (
              <ul className="space-y-1 text-sm text-amber-800">
                {validacion.avisos.map((a, i) => (
                  <li key={i}>{a.mensaje}</li>
                ))}
              </ul>
            )}
            <ResumenEmision
              vista={estado.vista}
              vigente={vigente}
              cargandoVista={cargandoVista}
              vistaHabilitada={vistaHabilitada}
              onVistaPrevia={pedirVistaPrevia}
              tildadas={estado.tildadas}
              onTildar={tildar}
              emision={emision}
              onEmitir={emitir}
              emitiendo={emitiendo}
              error={estado.error}
              reintento={estado.reintento}
              onReintentar={reintentar}
              onDescartarReintento={descartarReintento}
              frenada={estado.frenada}
              moneda={moneda}
            />
          </CardContent>
        </Card>
      )}

      {/* Totales (pie fijo) */}
      {cliente && !clienteBloqueado && (
        <div className="sticky bottom-0 z-10 -mx-6 border-t bg-white/95 px-6 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur dark:bg-gray-900/95">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm">
              <span className="font-semibold">{etiquetaComprobante(letra, !!(vigente && estado.vista?.data.esFce))}</span>
              <span className="text-muted-foreground"> · {moneda}</span>
              <p className="text-xs text-amber-700">No genera comisión: si corresponde, cargala como venta manual en Comisiones.</p>
              {notaRedondeo && <p className="text-xs text-muted-foreground">{notaRedondeo}</p>}
            </div>
            {totales && (
              <div className="flex flex-wrap items-end gap-6 text-right">
                {letra === 'A' ? (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">Neto gravado</p>
                      <p className="font-mono">{formatCurrency(totales.neto, moneda)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">IVA 21%</p>
                      <p className="font-mono">{formatCurrency(totales.iva, moneda)}</p>
                    </div>
                  </>
                ) : (
                  <div>
                    <p className="text-xs text-muted-foreground">IVA contenido (Ley 27.743)</p>
                    <p className="font-mono">{formatCurrency(totales.iva, moneda)}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="font-mono text-xl font-bold">{formatCurrency(totales.total, moneda)}</p>
                </div>
                {moneda === 'USD' && (
                  <div>
                    <p className="text-xs text-muted-foreground">Equivalente en pesos</p>
                    <p className="font-mono">{Number.isFinite(totales.totalArs) ? formatCurrency(totales.totalArs, 'ARS') : '—'}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Emitiendo: no cerrar */}
      {emitiendo && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-white/70 backdrop-blur-sm dark:bg-gray-950/70" role="status" aria-live="assertive">
          <div className="flex flex-col items-center gap-3 rounded-lg border bg-white p-6 shadow-lg dark:bg-gray-900">
            <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
            <p className="text-lg font-semibold">Emitiendo en ARCA…</p>
            <p className="text-sm text-muted-foreground">No cierres esta ventana ni recargues la página.</p>
          </div>
        </div>
      )}

      <EmisionBloqueadaDialog bloqueo={estado.bloqueo} onEntendido={() => setEstado((e) => ({ ...e, bloqueo: null }))} />
    </div>
  )
}

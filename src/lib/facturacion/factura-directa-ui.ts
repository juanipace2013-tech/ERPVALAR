/**
 * Pantalla "Nueva factura" (/facturas/nueva): lógica del cliente sin React.
 *
 *  - Formulario (textos tal cual se tipean) → pedido de la API
 *    (/api/facturas/directa y /preview) y su firma: cualquier cambio en la
 *    firma invalida la vista previa y la clave de idempotencia.
 *  - Validación local con las MISMAS funciones que el servidor
 *    (calcularFacturaDirecta de factura-directa-form.ts).
 *  - Clasificación de la respuesta de la emisión (emitida, bloqueada,
 *    reintentar con la misma clave, confirmar o corregir) y qué hacer con la
 *    clave en cada caso.
 *  - Productos (IVA 21% solo, precio de venta sugerido), venta de ML (líneas
 *    para precargar), alta de cliente desde ARCA y el estado en Colppy del
 *    detalle de la factura.
 *
 * Módulo puro: lo importan componentes 'use client' (de los módulos de
 * servidor solo se importan tipos). Tests: tests/unit/factura-directa-ui.test.ts.
 */
import type { InspeccionVentaMl } from '@/lib/mercadolibre/venta-ml-vinculo'
import type { PreviewFacturaDirecta, ResultadoFacturaDirecta } from './factura-directa'
import { condicionPagoDesdeDias } from './condicion-pago'
import { letraFacturaColppy } from './letra-factura'
import { parseNumeroAr } from './nc-unidades'
import {
  MAX_LINEAS_FACTURA_DIRECTA,
  MAX_OBSERVACIONES_FACTURA_DIRECTA,
  calcularFacturaDirecta,
  codigoDeFirma,
  type CalculoFacturaDirecta,
  type ConfirmacionRequerida,
  type DocumentoReceptorB,
  type LetraFacturaDirecta,
  type MonedaFacturaDirecta,
  type ProblemaFacturaDirecta,
} from './factura-directa-form'

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * Roles que emiten facturas directas: los mismos que exigen las rutas
 * (ROLES.FINANZAS de src/lib/authz.ts, que no se importa acá porque trae
 * next/server). Un test controla que sean iguales.
 */
export const ROLES_FACTURA_DIRECTA: readonly string[] = ['ADMIN', 'GERENTE', 'CONTADOR']

export function puedeFacturaDirecta(role: string | null | undefined): boolean {
  return !!role && ROLES_FACTURA_DIRECTA.includes(role)
}

// ---------------------------------------------------------------------------
// Etiquetas
// ---------------------------------------------------------------------------

export const ETIQUETA_CONDICION_IVA_CLIENTE: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
  MONOTRIBUTO: 'Monotributista',
  EXENTO: 'Exento',
  CONSUMIDOR_FINAL: 'Consumidor Final',
  NO_RESPONSABLE: 'No Responsable',
  RESPONSABLE_NO_INSCRIPTO: 'Responsable No Inscripto',
  CLIENTE_EXTERIOR: 'Cliente del exterior',
}

export const etiquetaCondicionIva = (c: string | null | undefined): string =>
  c ? (ETIQUETA_CONDICION_IVA_CLIENTE[c] ?? c) : 'Sin condición'

export const ETIQUETA_DOC_TIPO: Record<number, string> = {
  80: 'CUIT',
  86: 'CUIL',
  96: 'DNI',
  99: 'Consumidor final sin identificar',
}

/** "Factura A", "Factura B" o "FCE MiPyME A" */
export function etiquetaComprobante(letra: LetraFacturaDirecta | null | undefined, esFce = false): string {
  if (!letra) return 'Factura'
  return esFce && letra === 'A' ? 'FCE MiPyME A' : `Factura ${letra}`
}

const round2 = (n: number) => Math.round(n * 100) / 100

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

/** Lo que la pantalla necesita del cliente (GET /api/clientes/[id]) */
export interface ClienteFacturaDirecta {
  id: string
  name: string
  businessName: string | null
  cuit: string
  taxCondition: string
  country: string | null
  status: string
  fceObligado: boolean
  paymentTerms: number | null
}

/** Normaliza la respuesta de GET /api/clientes/[id] (o de un alta) */
export function clienteDesdeApi(c: unknown): ClienteFacturaDirecta | null {
  if (!c || typeof c !== 'object') return null
  const r = c as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  const texto = (v: unknown) => (typeof v === 'string' ? v : '')
  const terms = Number(r.paymentTerms)
  return {
    id: r.id,
    name: texto(r.name),
    businessName: typeof r.businessName === 'string' && r.businessName.trim() ? r.businessName : null,
    cuit: texto(r.cuit),
    taxCondition: texto(r.taxCondition),
    country: typeof r.country === 'string' ? r.country : null,
    status: texto(r.status) || 'ACTIVE',
    fceObligado: r.fceObligado === true,
    paymentTerms: r.paymentTerms === null || r.paymentTerms === undefined || !Number.isFinite(terms) ? null : terms,
  }
}

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

/** Línea tal cual se tipea (números en formato argentino) */
export interface LineaFormFacturaDirecta {
  /** Id local de la fila (key de React) */
  uid: string
  productId: string | null
  sku: string | null
  descripcion: string
  cantidad: string
  precio: string
  comentario: string
}

/** Factura B: a quién se le factura en ARCA (el CUIT del cliente o un DNI/CUIL del comprador) */
export interface DocReceptorForm {
  tipo: 'CLIENTE' | 'DNI' | 'CUIL'
  nro: string
}

export interface FormFacturaDirecta {
  moneda: MonedaFacturaDirecta
  /** ARS por USD (solo en dólares) */
  tipoCambio: string
  condicionPago: string
  /** Solo cuenta en la A: en la B los precios son siempre finales */
  preciosConIva: boolean
  docReceptor: DocReceptorForm
  lineas: LineaFormFacturaDirecta[]
  observaciones: string
  /** Venta de ML vinculada (pack u orden), solo en pesos */
  mlVenta: string
}

export function lineaVacia(uid: string): LineaFormFacturaDirecta {
  return { uid, productId: null, sku: null, descripcion: '', cantidad: '1', precio: '', comentario: '' }
}

export function formInicial(uid: string): FormFacturaDirecta {
  return {
    moneda: 'ARS',
    tipoCambio: '',
    condicionPago: 'Contado',
    preciosConIva: false,
    docReceptor: { tipo: 'CLIENTE', nro: '' },
    lineas: [lineaVacia(uid)],
    observaciones: '',
    mlVenta: '',
  }
}

/**
 * Al elegir (o cambiar) el cliente: condición de pago según sus días de plazo,
 * precios con IVA en la B (siempre; en la A queda lo que estaba: arranca con
 * netos y, si venía de una B, los precios tipeados siguen siendo finales) y el
 * documento del comprador vuelve al CUIT del cliente. Las líneas se conservan.
 */
export function formParaCliente(form: FormFacturaDirecta, cliente: Pick<ClienteFacturaDirecta, 'taxCondition' | 'paymentTerms'>): FormFacturaDirecta {
  const letra = letraFacturaColppy(cliente.taxCondition)
  return {
    ...form,
    condicionPago: condicionPagoDesdeDias(cliente.paymentTerms),
    preciosConIva: letra === 'B' ? true : form.preciosConIva,
    docReceptor: { tipo: 'CLIENTE', nro: '' },
  }
}

/**
 * ¿Cambió lo que significa el precio tipeado (neto ↔ final con IVA)? Pasa al
 * cambiar de un cliente A a uno B (o al revés) con líneas cargadas: hay que
 * avisar para que revisen los precios.
 */
export function cambiaSignificadoPrecios(
  antes: { letra: LetraFacturaDirecta | null; preciosConIva: boolean },
  despues: { letra: LetraFacturaDirecta | null; preciosConIva: boolean }
): boolean {
  if (!antes.letra || !despues.letra) return false
  const finalAntes = antes.letra === 'B' || antes.preciosConIva
  const finalDespues = despues.letra === 'B' || despues.preciosConIva
  return finalAntes !== finalDespues
}

/** Número → texto para un campo del formulario ("1234,5"): sin separador de miles, nunca ambiguo para parseNumeroAr */
export function numeroATexto(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return ''
  return String(Math.round(n * 10000) / 10000).replace('.', ',')
}

/** Fila sin nada cargado (ni producto): se muestra sin errores hasta que se pide la vista previa */
export function lineaEnBlanco(l: Pick<LineaFormFacturaDirecta, 'productId' | 'descripcion' | 'precio' | 'comentario'>): boolean {
  return !l.productId && !l.descripcion.trim() && !l.precio.trim() && !l.comentario.trim()
}

/** Número del formulario para el pedido: el número si se entiende; si no, el texto (el servidor lo rechaza con su mensaje) */
function numeroPedido(s: string): number | string {
  const n = parseNumeroAr(s)
  return Number.isFinite(n) ? n : s.trim()
}

/** Documento del comprador que viaja como documentoReceptorB (solo en la B y si no es el CUIT del cliente) */
export function documentoReceptorDesdeForm(letra: LetraFacturaDirecta | null, doc: DocReceptorForm): DocumentoReceptorB | null {
  if (letra !== 'B' || doc.tipo === 'CLIENTE') return null
  return { docTipo: doc.tipo === 'DNI' ? 96 : 86, docNro: doc.nro.replace(/\D/g, '') }
}

/** Cuerpo común de /api/facturas/directa y /preview (sin clave ni confirmaciones) */
export interface PedidoFacturaDirectaUi {
  customerId: string
  moneda: MonedaFacturaDirecta
  tipoCambio: number | string | null
  condicionPago: string
  preciosConIva: boolean
  documentoReceptorB: DocumentoReceptorB | null
  lineas: Array<{ productId: string | null; descripcion: string; cantidad: number | string; precioUnitario: number | string; comentario: string | null }>
  observaciones: string | null
  mlVenta: string | null
}

export function armarPedidoFacturaDirecta(cliente: Pick<ClienteFacturaDirecta, 'id' | 'taxCondition'>, form: FormFacturaDirecta): PedidoFacturaDirectaUi {
  const letra = letraFacturaColppy(cliente.taxCondition)
  const ml = form.mlVenta.replace(/\s/g, '')
  return {
    customerId: cliente.id,
    moneda: form.moneda,
    tipoCambio: form.moneda === 'USD' ? numeroPedido(form.tipoCambio) : null,
    condicionPago: form.condicionPago,
    preciosConIva: letra === 'B' ? true : form.preciosConIva,
    documentoReceptorB: documentoReceptorDesdeForm(letra, form.docReceptor),
    lineas: form.lineas.map((l) => ({
      productId: l.productId,
      descripcion: l.descripcion.replace(/\s+/g, ' ').trim(),
      cantidad: numeroPedido(l.cantidad),
      precioUnitario: numeroPedido(l.precio),
      comentario: l.comentario.trim() || null,
    })),
    observaciones: form.observaciones.trim() || null,
    mlVenta: ml || null,
  }
}

/** Firma del pedido: si cambia después de la vista previa, la vista previa y la clave dejan de valer */
export function firmaPedidoFacturaDirecta(p: PedidoFacturaDirectaUi): string {
  return JSON.stringify(p)
}

/**
 * Cuerpo del POST de emisión: pedido + clave + las FIRMAS de las
 * confirmaciones tildadas (solo de las que pidió el servidor). La firma ata
 * el tilde al texto que se mostró: si al emitir el motivo cambió, el servidor
 * vuelve a pedir confirmación.
 */
export function cuerpoEmisionFacturaDirecta(
  pedido: PedidoFacturaDirectaUi,
  idempotencyKey: string,
  requeridas: ConfirmacionRequerida[],
  tildadas: readonly string[]
): PedidoFacturaDirectaUi & { idempotencyKey: string; confirmaciones: string[] } {
  const set = new Set(tildadas)
  return { ...pedido, idempotencyKey, confirmaciones: requeridas.map((r) => r.firma).filter((f) => set.has(f)) }
}

/**
 * ¿El reintento (mismo cuerpo, misma clave) lleva solo confirmaciones que
 * siguen tildadas? Si se destildó alguna, no se reintenta: hay que volver a
 * editar (el cuerpo guardado la confirmaría igual).
 */
export function reintentoConConfirmacionesVigentes(cuerpo: { confirmaciones: readonly string[] }, tildadas: readonly string[]): boolean {
  const set = new Set(tildadas)
  return cuerpo.confirmaciones.every((f) => set.has(f))
}

// ---------------------------------------------------------------------------
// Validación local (las mismas reglas que el servidor)
// ---------------------------------------------------------------------------

export interface ValidacionFormFacturaDirecta {
  letra: LetraFacturaDirecta | null
  /** null sin cliente o con un cliente que no se factura desde acá */
  calculo: CalculoFacturaDirecta | null
  errores: ProblemaFacturaDirecta[]
  avisos: ProblemaFacturaDirecta[]
}

/**
 * Validación de la pantalla (sin base de datos ni ARCA). El umbral de la FCE
 * no se conoce en el navegador: la vista previa dice si sale como FCE.
 */
export function validarFormularioFacturaDirecta(
  cliente: ClienteFacturaDirecta | null,
  form: FormFacturaDirecta
): ValidacionFormFacturaDirecta {
  if (!cliente) return { letra: null, calculo: null, errores: [{ codigo: 'SIN_CLIENTE', mensaje: 'Elegí el cliente' }], avisos: [] }
  const pedido = armarPedidoFacturaDirecta(cliente, form)
  const letra = letraFacturaColppy(cliente.taxCondition)
  const calculo = calcularFacturaDirecta({
    taxCondition: cliente.taxCondition,
    cuit: cliente.cuit,
    country: cliente.country,
    fceObligado: cliente.fceObligado,
    lineas: pedido.lineas.map((l) => ({
      descripcion: l.descripcion,
      cantidad: typeof l.cantidad === 'number' ? l.cantidad : NaN,
      precioUnitario: typeof l.precioUnitario === 'number' ? l.precioUnitario : NaN,
      comentario: l.comentario,
    })),
    moneda: form.moneda,
    tipoCambio: typeof pedido.tipoCambio === 'number' ? pedido.tipoCambio : NaN,
    preciosConIva: pedido.preciosConIva,
    fceMontoMinimo: Infinity,
    documentoReceptorB: pedido.documentoReceptorB,
  })
  const errores: ProblemaFacturaDirecta[] = []
  if (cliente.status && cliente.status !== 'ACTIVE') errores.push({ codigo: 'CLIENTE_INACTIVO', mensaje: `El cliente ${cliente.name} está inactivo` })
  const bloqueado = calculo.errores.some((e) => e.codigo === 'CLIENTE_EXTERIOR' || e.codigo === 'CONDICION_NO_SOPORTADA')
  errores.push(...calculo.errores)
  if (form.lineas.length > MAX_LINEAS_FACTURA_DIRECTA && !errores.some((e) => e.codigo === 'DEMASIADAS_LINEAS')) {
    errores.push({ codigo: 'DEMASIADAS_LINEAS', mensaje: `La factura admite hasta ${MAX_LINEAS_FACTURA_DIRECTA} líneas` })
  }
  if ((pedido.observaciones ?? '').length > MAX_OBSERVACIONES_FACTURA_DIRECTA) {
    errores.push({ codigo: 'OBSERVACIONES_LARGAS', mensaje: `Las observaciones superan ${MAX_OBSERVACIONES_FACTURA_DIRECTA} caracteres` })
  }
  if (pedido.mlVenta) {
    if (!/^\d{1,20}$/.test(pedido.mlVenta)) errores.push({ codigo: 'ML_VENTA_INVALIDA', mensaje: 'El número de la venta de Mercado Libre tiene que ser solo dígitos' })
    else if (form.moneda !== 'ARS') errores.push({ codigo: 'ML_SOLO_ARS', mensaje: 'Una venta de Mercado Libre solo se vincula a una factura en pesos' })
  }
  // La comisión se avisa en el pie de la pantalla
  const avisos = calculo.avisos.filter((a) => a.codigo !== 'SIN_COMISION')
  return { letra, calculo: bloqueado ? null : calculo, errores, avisos }
}

/** Errores de una fila (para mostrarlos debajo de la línea) */
export function erroresDeLinea(errores: ProblemaFacturaDirecta[], indice: number): ProblemaFacturaDirecta[] {
  return errores.filter((e) => e.linea === indice + 1)
}

/**
 * Factura A con precios con IVA: el neto se calcula primero y el total puede
 * quedar unos centavos debajo de la suma de los precios finales ($100 → 99,99).
 */
export function notaRedondeoPreciosConIva(
  letra: LetraFacturaDirecta | null,
  preciosConIva: boolean,
  lineas: Array<{ cantidad: number | string; precioUnitario: number | string }>,
  total: number
): string | null {
  if (letra !== 'A' || !preciosConIva || !Number.isFinite(total)) return null
  const suma = round2(
    lineas.reduce((s, l) => {
      const c = Number(l.cantidad)
      const p = Number(l.precioUnitario)
      return typeof l.cantidad === 'number' && typeof l.precioUnitario === 'number' && c > 0 && p > 0 ? s + c * p : s
    }, 0)
  )
  const dif = round2(Math.abs(suma - total))
  if (dif < 0.005 || dif >= 1) return null
  const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `La Factura A discrimina el IVA (neto primero): los precios finales suman ${fmt(suma)} y la factura da ${fmt(total)}`
}

// ---------------------------------------------------------------------------
// Clave de idempotencia
// ---------------------------------------------------------------------------

/** UUID v4 (crypto.randomUUID si existe; si no, con getRandomValues) */
export function nuevaClaveIdempotencia(c: Pick<Crypto, 'getRandomValues'> & { randomUUID?: () => string } = globalThis.crypto): string {
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// ---------------------------------------------------------------------------
// Vista previa
// ---------------------------------------------------------------------------

/** Respuesta de error de la API: { error, codigo, ...extra } */
export interface ErrorApiFacturaDirecta {
  error?: string
  codigo?: string
  errores?: unknown
  confirmacionesRequeridas?: ConfirmacionRequerida[]
  faltantes?: string[]
  cae?: string | null
  numero?: string | number | null
  cbteTipo?: number
  puntoVenta?: number
  facturaDirectaId?: string
  detalle?: string
}

/** Lista de problemas de un cuerpo de error (errores[] de validación, de ARCA o textos del 400) */
export function problemasDeError(d: ErrorApiFacturaDirecta | null | undefined, status?: number): ProblemaFacturaDirecta[] {
  const out: ProblemaFacturaDirecta[] = []
  const lista = Array.isArray(d?.errores) ? (d!.errores as unknown[]) : []
  for (const e of lista) {
    if (typeof e === 'string') out.push({ codigo: d?.codigo ?? 'PEDIDO_INVALIDO', mensaje: e })
    else if (e && typeof e === 'object') {
      const r = e as Record<string, unknown>
      if (typeof r.mensaje === 'string') {
        out.push({ codigo: String(r.codigo ?? d?.codigo ?? 'ERROR'), mensaje: r.mensaje, ...(typeof r.linea === 'number' ? { linea: r.linea } : {}) })
      } else if (r.Msg !== undefined || r.Code !== undefined) {
        out.push({ codigo: `ARCA ${String(r.Code ?? '')}`.trim(), mensaje: String(r.Msg ?? '') })
      }
    }
  }
  if (!out.length) out.push({ codigo: d?.codigo ?? 'ERROR', mensaje: d?.error || (status ? `Error ${status}` : 'Error') })
  // ARCA_RECHAZO 10192 trae el texto traducido en error y el original en detalle
  if (d?.codigo === 'ARCA_RECHAZO' && d.error && !out.some((p) => p.mensaje === d.error)) out.unshift({ codigo: 'ARCA_RECHAZO', mensaje: d.error })
  return out
}

/** La vista previa con lo que hace falta para emitir */
export interface VistaPreviaVigente {
  data: PreviewFacturaDirecta
  /** firmaPedidoFacturaDirecta del pedido que se previsualizó */
  firma: string
  /** Clave de idempotencia (solo si la vista previa salió ok) */
  clave: string | null
}

/** ¿Se puede emitir? (vista previa vigente y ok, con clave, y todas las confirmaciones tildadas: `tildadas` son firmas) */
export function puedeEmitirFacturaDirecta(
  vista: VistaPreviaVigente | null,
  firmaActual: string,
  tildadas: readonly string[]
): { puede: boolean; motivo: string | null } {
  if (!vista) return { puede: false, motivo: 'Pedí la vista previa' }
  if (vista.firma !== firmaActual) return { puede: false, motivo: 'La vista previa quedó desactualizada: pedila de nuevo' }
  if (!vista.data.ok || !vista.clave) return { puede: false, motivo: 'Corregí lo marcado en la vista previa' }
  const set = new Set(tildadas)
  const faltan = vista.data.confirmacionesRequeridas.filter((c) => !set.has(c.firma))
  if (faltan.length) return { puede: false, motivo: `Falta confirmar ${faltan.length === 1 ? '1 punto' : `${faltan.length} puntos`}` }
  return { puede: true, motivo: null }
}

// ---------------------------------------------------------------------------
// Emisión: clasificación de la respuesta y la clave
// ---------------------------------------------------------------------------

/** Resultado que obliga a parar: ARCA pudo haber emitido (o emitió) y el ERP no lo tiene. NO se reintenta. */
export interface BloqueoEmisionDirecta {
  tipo: 'INCIERTA' | 'HUERFANA'
  mensaje: string
  /** "0007-00000123" si se sabe */
  numero: string | null
  cae: string | null
  facturaDirectaId: string | null
}

export type ResultadoEmisionDirecta =
  | { tipo: 'emitida'; factura: ResultadoFacturaDirecta }
  /** ARCA_INCIERTO / ERP_HUERFANA: diálogo bloqueante, no se vuelve a emitir desde la pantalla */
  | { tipo: 'bloqueada'; bloqueo: BloqueoEmisionDirecta }
  /** Se puede reintentar con LA MISMA clave (si ya se emitió, el servidor devuelve la misma factura) */
  | { tipo: 'reintentar'; titulo: string; mensaje: string; codigo: string | null }
  /** El servidor pide confirmaciones nuevas (la clave sirve: no se reservó) */
  | { tipo: 'confirmar'; mensaje: string; requeridas: ConfirmacionRequerida[]; faltantes: string[] }
  /** Hay que corregir algo (la vista previa y la clave dejan de valer) */
  | { tipo: 'error'; titulo: string; problemas: ProblemaFacturaDirecta[]; refrescarPendientes: boolean }

function numeroComprobante(d: ErrorApiFacturaDirecta): string | null {
  if (typeof d.numero === 'string' && d.numero.trim()) return d.numero.trim()
  if (typeof d.numero === 'number' && Number.isFinite(d.numero) && d.numero > 0 && d.puntoVenta) {
    return `${String(d.puntoVenta).padStart(4, '0')}-${String(d.numero).padStart(8, '0')}`
  }
  return null
}

const MENSAJE_REINTENTO_SEGURO =
  'Reintentar es seguro: va con la misma clave, así que si la factura ya se emitió el servidor devuelve esa misma factura y no emite otra.'

/**
 * Qué pasó con el POST de emisión. `errorRed`: el fetch no tuvo respuesta
 * (se cortó la conexión): no se sabe si se emitió, pero reintentar con la
 * misma clave es seguro (idempotencia del servidor).
 */
export function clasificarRespuestaEmision(r: { status: number; body: unknown } | { errorRed: string }): ResultadoEmisionDirecta {
  if ('errorRed' in r) {
    return {
      tipo: 'reintentar',
      titulo: 'Se cortó la conexión mientras se emitía',
      mensaje: `No se sabe si la factura se emitió (${r.errorRed}). ${MENSAJE_REINTENTO_SEGURO}`,
      codigo: null,
    }
  }
  const { status } = r
  const d = (r.body && typeof r.body === 'object' ? r.body : {}) as ErrorApiFacturaDirecta & Partial<ResultadoFacturaDirecta>

  if (status >= 200 && status < 300) {
    if (typeof d.invoiceId === 'string' && d.invoiceId && typeof d.cae === 'string') {
      return { tipo: 'emitida', factura: d as ResultadoFacturaDirecta }
    }
    return {
      tipo: 'reintentar',
      titulo: 'Respuesta inesperada del servidor',
      mensaje: `El servidor respondió ${status} sin los datos de la factura. ${MENSAJE_REINTENTO_SEGURO}`,
      codigo: null,
    }
  }

  const codigo = typeof d.codigo === 'string' ? d.codigo : null
  const mensaje = d.error || `Error ${status}`

  if (codigo === 'ARCA_INCIERTO') {
    return {
      tipo: 'bloqueada',
      bloqueo: { tipo: 'INCIERTA', mensaje, numero: numeroComprobante(d), cae: null, facturaDirectaId: d.facturaDirectaId ?? null },
    }
  }
  if (codigo === 'ERP_HUERFANA') {
    return {
      tipo: 'bloqueada',
      bloqueo: { tipo: 'HUERFANA', mensaje, numero: numeroComprobante(d), cae: d.cae ?? null, facturaDirectaId: d.facturaDirectaId ?? null },
    }
  }
  if (codigo === 'CONFIRMACION_REQUERIDA') {
    return {
      tipo: 'confirmar',
      mensaje,
      requeridas: Array.isArray(d.confirmacionesRequeridas) ? d.confirmacionesRequeridas : [],
      faltantes: Array.isArray(d.faltantes) ? d.faltantes : [],
    }
  }
  if (codigo === 'ARCA_NO_SOLICITADA') {
    return { tipo: 'reintentar', titulo: 'No se pudo pedir el CAE a ARCA (no se emitió nada)', mensaje, codigo }
  }
  if (codigo === 'EN_CURSO') {
    return { tipo: 'reintentar', titulo: 'La factura se está emitiendo', mensaje: `${mensaje}. ${MENSAJE_REINTENTO_SEGURO}`, codigo }
  }
  if (codigo === 'ML_NO_DISPONIBLE') {
    return { tipo: 'reintentar', titulo: 'No se pudo consultar Mercado Libre (no se emitió nada)', mensaje, codigo }
  }
  if (status === 401) return { tipo: 'error', titulo: 'La sesión venció: volvé a iniciar sesión', problemas: [{ codigo: 'SESION', mensaje }], refrescarPendientes: false }
  if (status === 403) return { tipo: 'error', titulo: 'No tenés permisos para emitir facturas directas', problemas: [{ codigo: 'SIN_PERMISOS', mensaje }], refrescarPendientes: false }
  // Error del servidor sin código (excepción no prevista, proxy caído): el resultado es desconocido
  if (status >= 500 && !codigo) {
    return {
      tipo: 'reintentar',
      titulo: `El servidor no respondió bien (HTTP ${status})`,
      mensaje: `${d.error ? `${d.error}. ` : ''}No se sabe si la factura se emitió. ${MENSAJE_REINTENTO_SEGURO}`,
      codigo: null,
    }
  }
  const titulo =
    codigo === 'ARCA_RECHAZO'
      ? 'ARCA rechazó la factura (no se emitió nada): corregí y volvé a pedir la vista previa'
      : codigo === 'EMISION_PENDIENTE'
        ? 'Hay otra factura directa de este cliente sin resolver'
        : codigo === 'YA_FACTURADA'
          ? 'La venta de Mercado Libre ya está facturada'
          : status === 503
            ? 'La emisión no está disponible en el servidor'
            : status === 400
              ? 'Pedido inválido (no se llamó a ARCA)'
              : 'Datos a corregir (no se llamó a ARCA)'
  return { tipo: 'error', titulo, problemas: problemasDeError(d, status), refrescarPendientes: codigo === 'EMISION_PENDIENTE' }
}

/**
 * Qué hacer con la clave después de la respuesta:
 *  - conservar: reintentar o confirmar con la misma (no duplica);
 *  - regenerar: hay que corregir; la vista previa deja de valer y la próxima
 *    vista previa ok genera otra;
 *  - descartar: la factura salió (o quedó bloqueada): no se emite más con ella.
 */
export function claveTrasResultado(r: ResultadoEmisionDirecta): 'conservar' | 'regenerar' | 'descartar' {
  switch (r.tipo) {
    case 'reintentar':
    case 'confirmar':
      return 'conservar'
    case 'error':
      return 'regenerar'
    default:
      return 'descartar'
  }
}

/** Vista previa con las confirmaciones que pidió el servidor al emitir (409 CONFIRMACION_REQUERIDA) */
export function aplicarConfirmacionesRequeridas(vista: VistaPreviaVigente, requeridas: ConfirmacionRequerida[]): VistaPreviaVigente {
  if (!requeridas.length) return vista
  return { ...vista, data: { ...vista.data, confirmacionesRequeridas: requeridas } }
}

/** Cuerpo del POST de emisión (pedido + clave + confirmaciones) */
export type CuerpoEmisionFacturaDirecta = ReturnType<typeof cuerpoEmisionFacturaDirecta>

/** Estado de la emisión en la pantalla */
export interface EstadoEmisionUi {
  vista: VistaPreviaVigente | null
  /** Firmas (ConfirmacionRequerida.firma) de las confirmaciones tildadas */
  tildadas: string[]
  /** Se puede reintentar exactamente el mismo pedido (misma clave) */
  reintento: { titulo: string; mensaje: string; cuerpo: CuerpoEmisionFacturaDirecta } | null
  /** Hay que corregir algo */
  error: { titulo: string; problemas: ProblemaFacturaDirecta[] } | null
  /** Diálogo bloqueante (ARCA_INCIERTO / ERP_HUERFANA) */
  bloqueo: BloqueoEmisionDirecta | null
  /** Hubo un resultado bloqueante: no se emite más desde la pantalla */
  frenada: boolean
}

export const ESTADO_EMISION_INICIAL: EstadoEmisionUi = { vista: null, tildadas: [], reintento: null, error: null, bloqueo: null, frenada: false }

/** Una edición invalida la vista previa y su clave (la próxima vista previa ok genera otra) */
export function invalidarVistaPrevia(v: VistaPreviaVigente | null): VistaPreviaVigente | null {
  return v ? { ...v, firma: '', clave: null } : null
}

/**
 * Estado después de la respuesta de la emisión (`cuerpo` = lo que se mandó):
 *  - emitida: la clave ya no se usa (la pantalla navega a la factura);
 *  - bloqueada: diálogo bloqueante y la pantalla queda frenada;
 *  - reintentar: se guarda el mismo cuerpo (misma clave) para "Reintentar";
 *  - confirmar: se muestran las confirmaciones que pide el servidor; queda tildado solo lo
 *    que sigue igual (misma firma) y no falta (misma clave);
 *  - error: se muestra y la vista previa deja de valer (otra vista previa → otra clave).
 */
export function estadoTrasEmision(e: EstadoEmisionUi, r: ResultadoEmisionDirecta, cuerpo: CuerpoEmisionFacturaDirecta): EstadoEmisionUi {
  switch (r.tipo) {
    case 'emitida':
      return { ...e, vista: e.vista ? { ...e.vista, clave: null } : null, reintento: null, error: null }
    case 'bloqueada':
      return { ...e, vista: e.vista ? { ...e.vista, clave: null } : null, reintento: null, error: null, bloqueo: r.bloqueo, frenada: true }
    case 'reintentar':
      return { ...e, reintento: { titulo: r.titulo, mensaje: r.mensaje, cuerpo }, error: null }
    case 'confirmar': {
      const faltan = new Set(r.faltantes)
      // Un tilde vale solo para el texto que se mostró: si la firma cambió, se destilda
      const vigentes = r.requeridas.length ? new Set(r.requeridas.map((c) => c.firma)) : null
      return {
        ...e,
        vista: e.vista ? aplicarConfirmacionesRequeridas(e.vista, r.requeridas) : null,
        tildadas: e.tildadas.filter((f) => !faltan.has(codigoDeFirma(f)) && (!vigentes || vigentes.has(f))),
        reintento: null,
        error: { titulo: 'Hay que confirmar algo más antes de emitir', problemas: [{ codigo: 'CONFIRMACION_REQUERIDA', mensaje: r.mensaje }] },
      }
    }
    case 'error':
      return { ...e, vista: invalidarVistaPrevia(e.vista), tildadas: [], reintento: null, error: { titulo: r.titulo, problemas: r.problemas } }
  }
}

export interface AvisoResultadoEmision {
  nivel: 'success' | 'warning' | 'info'
  titulo: string
  descripcion?: string
}

/** Toasts después de emitir: la factura, y si Colppy quedó pendiente o falló la subida a ML */
export function avisosResultadoEmision(f: ResultadoFacturaDirecta): AvisoResultadoEmision[] {
  const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const out: AvisoResultadoEmision[] = [
    {
      nivel: 'success',
      titulo: f.repetida ? `La factura ${f.invoiceNumber} ya se había emitido (no se emitió otra)` : `Factura ${f.invoiceNumber} emitida`,
      descripcion: `CAE ${f.cae} · ${f.currency} ${fmt(Number(f.total))}`,
    },
  ]
  const c = f.colppy?.estado
  if (c === 'BORRADOR_FCE') {
    out.push({
      nivel: 'warning',
      titulo: 'Salió como FCE MiPyME: en Colppy quedó como BORRADOR',
      descripcion: 'Abrila en Colppy, tildá "Factura de crédito electrónica MiPyME (FCE)" y aprobala.',
    })
  } else if (c === 'ERROR') {
    out.push({ nivel: 'warning', titulo: 'No se pudo registrar en Colppy: reintentalo desde la factura', descripcion: f.colppy.error })
  } else if (c === 'PENDIENTE') {
    out.push({ nivel: 'info', titulo: 'Falta registrarla en Colppy', descripcion: 'Usá "Reintentar registro en Colppy" en la factura.' })
  } else if (c === 'REGISTRANDO') {
    out.push({ nivel: 'info', titulo: 'Se está registrando en Colppy', descripcion: 'Revisá la factura en unos minutos.' })
  }
  if (f.ml && !f.ml.uploadOk) {
    if (f.ml.error || !f.repetida) {
      out.push({
        nivel: 'warning',
        titulo: 'La factura no se pudo subir a Mercado Libre',
        descripcion: `${f.ml.error ? `${f.ml.error}. ` : ''}Reintentalo desde la factura.`,
      })
    } else {
      // Repetida sin error: el primer pedido puede estar subiéndola todavía (no reintentar ya)
      out.push({
        nivel: 'info',
        titulo: 'La subida a Mercado Libre puede estar en curso',
        descripcion: 'Revisá la factura en unos minutos antes de reintentar la subida.',
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

export interface PrecioProducto {
  priceType: string
  currency: string
  amount: number | string
  validFrom?: string | null
  validUntil?: string | null
}

/** El producto se puede facturar en v1: IVA 21% (null cuenta como 21, como en el servidor) */
export function ivaProductoSoportado(taxRate: number | string | null | undefined): boolean {
  return Number(taxRate ?? 21) === 21
}

/**
 * Precio de venta del ERP (SALE) en la moneda de la factura, vigente y el más
 * nuevo. Los precios del ERP son netos: con precios finales se suma el 21%.
 */
export function precioVentaSugerido(
  precios: PrecioProducto[] | null | undefined,
  moneda: MonedaFacturaDirecta,
  preciosFinales: boolean,
  ahora = new Date()
): { neto: number; precio: number } | null {
  const t = ahora.getTime()
  const vigentes = (precios ?? []).filter((p) => {
    if (p.priceType !== 'SALE' || p.currency !== moneda) return false
    const amount = Number(p.amount)
    if (!Number.isFinite(amount) || amount <= 0) return false
    const desde = p.validFrom ? new Date(p.validFrom).getTime() : -Infinity
    const hasta = p.validUntil ? new Date(p.validUntil).getTime() : Infinity
    return !(desde > t) && !(hasta < t)
  })
  if (!vigentes.length) return null
  vigentes.sort((a, b) => (b.validFrom ? new Date(b.validFrom).getTime() : 0) - (a.validFrom ? new Date(a.validFrom).getTime() : 0))
  const neto = round2(Number(vigentes[0].amount))
  return { neto, precio: preciosFinales ? round2(neto * 1.21) : neto }
}

/**
 * Línea con el producto elegido (SKU y descripción del ERP). Un producto con
 * IVA distinto de 21% no se acepta (el servidor lo rechaza: IVA_NO_SOPORTADO).
 */
export function lineaConProducto(
  linea: LineaFormFacturaDirecta,
  p: { id: string; sku: string; name: string; taxRate?: number | string | null }
): { linea: LineaFormFacturaDirecta; error: null } | { linea: null; error: string } {
  if (!ivaProductoSoportado(p.taxRate)) {
    return {
      linea: null,
      error: `${p.sku} tiene IVA ${Number(p.taxRate)}%: por ahora la factura directa solo emite con IVA 21%`,
    }
  }
  return { linea: { ...linea, productId: p.id, sku: p.sku, descripcion: (p.name || p.sku).replace(/\s+/g, ' ').trim().slice(0, 200) }, error: null }
}

// ---------------------------------------------------------------------------
// Venta de Mercado Libre
// ---------------------------------------------------------------------------

/** Líneas de la venta para precargar (precios finales, con IVA: en la A se prende "precios con IVA") */
export function lineasDesdeVentaMl(v: Pick<InspeccionVentaMl, 'lineas'>, nuevoUid: () => string): LineaFormFacturaDirecta[] {
  return v.lineas.map((l) => ({
    uid: nuevoUid(),
    productId: l.productId,
    sku: l.sku,
    descripcion: l.descripcion.replace(/\s+/g, ' ').trim().slice(0, 200),
    cantidad: numeroATexto(l.cantidad),
    precio: numeroATexto(l.precioUnitario),
    comentario: '',
  }))
}

/** Problemas de la venta de ML que impiden facturarla (los mismos que valida el servidor al emitir) */
export function bloqueosVentaMl(v: Pick<InspeccionVentaMl, 'yaFacturada' | 'pagada' | 'noPagas' | 'packId'>): string[] {
  const out: string[] = []
  if (v.yaFacturada) {
    out.push(
      v.yaFacturada.invoiceNumber
        ? `La venta ${v.packId} ya fue facturada desde el ERP (${v.yaFacturada.invoiceNumber})`
        : `La venta ${v.packId} se está facturando o quedó con la emisión sin terminar`
    )
  }
  if (!v.pagada) out.push(`Hay órdenes sin pagar: ${v.noPagas.map((o) => `${o.orderId} (${o.status})`).join(', ') || '-'}`)
  return out
}

// ---------------------------------------------------------------------------
// Alta de cliente desde ARCA
// ---------------------------------------------------------------------------

export interface FormAltaCliente {
  cuit: string
  name: string
  type: 'BUSINESS' | 'INDIVIDUAL'
  taxCondition: string
  address: string
  city: string
  province: string
  postalCode: string
  email: string
  paymentTerms: string
  notes: string
}

export const CONDICIONES_ALTA_CLIENTE = ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL'] as const

/** Formulario a partir de GET /api/afip/cuit/[cuit] (data) */
export function altaClienteDesdeArca(cuit: string, data: Record<string, unknown> | null | undefined): FormAltaCliente {
  const t = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const cond = t(data?.taxCondition)
  return {
    cuit: cuit.replace(/\D/g, ''),
    name: t(data?.name) || t(data?.businessName),
    type: data?.type === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'BUSINESS',
    // Sin condición en ARCA: se elige a mano (la vista previa la vuelve a controlar contra el padrón)
    taxCondition: (CONDICIONES_ALTA_CLIENTE as readonly string[]).includes(cond) ? cond : '',
    address: t(data?.address),
    city: t(data?.city),
    province: t(data?.province),
    postalCode: t(data?.postalCode),
    email: '',
    paymentTerms: '',
    notes: t(data?.notes),
  }
}

/** Errores del formulario de alta (antes de llamar a POST /api/clientes) */
export function validarAltaCliente(f: FormAltaCliente, cuitValido: (c: string) => boolean): string[] {
  const out: string[] = []
  if (f.cuit.length !== 11 || !cuitValido(f.cuit)) out.push('El CUIT no es válido')
  if (f.name.trim().length < 2) out.push('Falta el nombre o la razón social')
  if (!(CONDICIONES_ALTA_CLIENTE as readonly string[]).includes(f.taxCondition)) out.push('Elegí la condición frente al IVA')
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) out.push('El email no es válido')
  if (f.paymentTerms.trim() && !/^\d{1,3}$/.test(f.paymentTerms.trim())) out.push('Los días de plazo tienen que ser un número entero')
  return out
}

/** Cuerpo de POST /api/clientes (mismos campos que el alta de /clientes/nuevo) */
export function cuerpoAltaCliente(f: FormAltaCliente): Record<string, unknown> {
  const opcional = (s: string) => (s.trim() ? s.trim() : undefined)
  return {
    name: f.name.trim(),
    businessName: f.name.trim(),
    type: f.type,
    cuit: f.cuit,
    taxCondition: f.taxCondition,
    email: opcional(f.email),
    address: opcional(f.address),
    city: opcional(f.city),
    province: opcional(f.province),
    postalCode: opcional(f.postalCode),
    country: 'Argentina',
    status: 'ACTIVE',
    paymentTerms: f.paymentTerms.trim() ? parseInt(f.paymentTerms.trim(), 10) : undefined,
    priceMultiplier: 1,
    notes: opcional(f.notes),
  }
}

/** POST /api/clientes rechazó el alta porque el CUIT ya existe (400 "Ya existe..." o 409 por carrera) */
export function altaClienteDuplicada(status: number, error: string | null | undefined): boolean {
  return status === 409 || (status === 400 && /ya existe/i.test(error ?? ''))
}

// ---------------------------------------------------------------------------
// Tipo de cambio
// ---------------------------------------------------------------------------

/** Último USD→ARS de GET /api/tipo-cambio?from=USD&to=ARS (rates[0]) */
export function tipoCambioDesdeApi(json: unknown): { rate: number; fecha: string | null } | null {
  const rates = (json as { rates?: unknown })?.rates
  if (!Array.isArray(rates)) return null
  const r = rates.find((x) => x && (x as { fromCurrency?: string }).fromCurrency === 'USD' && (x as { toCurrency?: string }).toCurrency === 'ARS') as
    | { rate?: unknown; validFrom?: unknown }
    | undefined
  const rate = Number(r?.rate)
  if (!r || !Number.isFinite(rate) || rate <= 0) return null
  return { rate, fecha: typeof r.validFrom === 'string' ? r.validFrom.slice(0, 10) : null }
}

// ---------------------------------------------------------------------------
// Detalle de la factura: Colppy
// ---------------------------------------------------------------------------

/** = REGISTRANDO_VENCE_MS de factura-directa.ts (un test controla que coincidan) */
export const REGISTRANDO_COLPPY_VENCE_MS = 15 * 60 * 1000

/** Estados en los que el botón "Reintentar registro en Colppy" no corresponde */
const COLPPY_SIN_REINTENTO = ['OK', 'BORRADOR_FCE', 'MANUAL', 'NO_APLICA']

/**
 * ¿Mostrar "Reintentar registro en Colppy"? Factura del ERP sin id de Colppy
 * en PENDIENTE/ERROR (o un estado viejo desconocido), o REGISTRANDO trabado
 * (más de 15 minutos: el servidor lo vuelve a tomar). Nunca en NO_APLICA.
 */
export function puedeReintentarColppy(
  inv: { emitidaPor: string | null; colppyId: string | null; colppySyncStatus: string | null; updatedAt?: string | null },
  ahora = new Date()
): boolean {
  if (inv.emitidaPor !== 'ARCA' || inv.colppyId || !inv.colppySyncStatus) return false
  const s = inv.colppySyncStatus
  if (COLPPY_SIN_REINTENTO.includes(s)) return false
  if (s === 'REGISTRANDO') {
    const t = inv.updatedAt ? new Date(inv.updatedAt).getTime() : NaN
    return Number.isFinite(t) && ahora.getTime() - t > REGISTRANDO_COLPPY_VENCE_MS
  }
  return true
}

/**
 * La NC de una factura del ERP sin payload de Colppy y sin registrar en
 * Colppy se rechaza (409 en nota-credito-arca.ts): hay que registrarla primero.
 */
export function ncRequiereRegistroColppy(inv: { tieneColppyPayload: boolean; colppySyncStatus: string | null }): boolean {
  return !inv.tieneColppyPayload && ['PENDIENTE', 'ERROR', 'REGISTRANDO'].includes(inv.colppySyncStatus ?? '')
}

/**
 * Una venta de ML sin mlUploadStatus todavía puede estar subiéndose (la
 * emisión sube el PDF después de registrar la factura): recién pasado este
 * tiempo sin resultado se ofrece reintentar la subida.
 */
export const SUBIDA_ML_EN_CURSO_MS = 5 * 60 * 1000

/**
 * Estado de la subida del PDF a la venta de ML en el detalle de la factura:
 * 'ok', 'error' (falló: se puede reintentar), 'en-curso' (sin resultado y
 * reciente: no se ofrece reintentar, se subiría dos veces) o 'sin-subir'
 * (sin resultado hace rato: se puede reintentar).
 */
export function estadoSubidaMl(
  ml: { mlUploadStatus: string | null; updatedAt?: string | Date | null },
  ahora = new Date()
): { estado: 'ok' | 'error' | 'en-curso' | 'sin-subir'; puedeReintentar: boolean } {
  if (ml.mlUploadStatus === 'OK') return { estado: 'ok', puedeReintentar: false }
  if (ml.mlUploadStatus === 'ERROR') return { estado: 'error', puedeReintentar: true }
  const t = ml.updatedAt ? new Date(ml.updatedAt).getTime() : NaN
  if (Number.isFinite(t) && ahora.getTime() - t < SUBIDA_ML_EN_CURSO_MS) return { estado: 'en-curso', puedeReintentar: false }
  return { estado: 'sin-subir', puedeReintentar: true }
}

/** Etiqueta corta del estado en Colppy de un comprobante asociado (null = registrado o sin estado) */
export function etiquetaColppyAsociado(status: string | null | undefined): string | null {
  if (!status || status === 'OK') return null
  if (status === 'BORRADOR_FCE') return 'Borrador FCE en Colppy'
  if (status === 'NO_APLICA') return 'No se registra en Colppy'
  if (status === 'REGISTRANDO') return 'Registrando en Colppy'
  return 'Pendiente Colppy'
}

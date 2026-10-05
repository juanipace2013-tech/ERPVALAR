/**
 * Factura directa ("Nueva factura", sin cotización): pedido, validaciones y
 * cálculo de la Factura A/B (o FCE A) del PV 7 que comparten la pantalla
 * /facturas/nueva y el servidor (src/lib/facturacion/factura-directa.ts).
 *
 * Los totales salen de las MISMAS funciones y con los mismos argumentos que
 * sendQuoteToColppy (colppy.ts): totalesFacturaA(lineas, 0, preciosConIva) y
 * totalesFacturaB(lineas, 0). Así lo que va a ARCA, la Invoice del ERP y el
 * alta posterior en Colppy coinciden al centavo.
 *
 * v1: IVA 21% fijo, concepto 1 (productos), fecha de hoy, ARS o USD con
 * CanMisMonExt 'N', sin bonificación por línea (se cargan precios ya
 * bonificados). La letra NUNCA se elige: sale de la condición del cliente.
 *
 * Módulo puro (lo importa un componente 'use client'): solo importa módulos
 * sin dependencias de servidor. El servidor vuelve a validar todo (padrón,
 * productos, Mercado Libre, duplicados, emisiones pendientes).
 */
import type { EmisionExternaDatos } from '@/lib/colppy'
import { esClienteExterior } from '@/lib/cliente-exterior'
import { esCuitValido } from '@/lib/cuit-utils'
import { letraFacturaColppy } from './letra-factura'
import { totalesFacturaA, totalesFacturaB } from './totales-factura'
import { esCondicionPago, fechaVtoDesde } from './condicion-pago'
import { parseNumeroAr } from './nc-unidades'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/**
 * RG 5866/2026 (art. 1 inc. f; RG 1415 Anexo II, A, Título II, inc. d): una
 * Factura B a consumidor final de $10.000.000 o más identifica al comprador
 * (DNI, CUIL o CDI). ARCA rechaza DocTipo 99 por encima del umbral (10015).
 */
export const UMBRAL_IDENTIFICACION_CF = 10_000_000
export const MAX_LINEAS_FACTURA_DIRECTA = 50
export const MAX_DESCRIPCION_LINEA = 200
export const MAX_COMENTARIO_LINEA = 200
export const MAX_OBSERVACIONES_FACTURA_DIRECTA = 500
export const TIPO_CAMBIO_MIN = 1
export const TIPO_CAMBIO_MAX = 100_000
/** Si el TC se aleja más que esto del último BNA billete cargado, se pide confirmación */
export const TOLERANCIA_TIPO_CAMBIO = 0.03
/** Tope de un precio unitario y de una cantidad (Decimal(12,2) de la Invoice) */
const MAX_PRECIO = 1_000_000_000
const MAX_CANTIDAD = 1_000_000
const MAX_TOTAL = 9_999_999_999

/** Condiciones IVA viejas del ERP que no discriminan IVA: no se facturan desde acá */
export const CONDICIONES_NO_SOPORTADAS = ['NO_RESPONSABLE', 'RESPONSABLE_NO_INSCRIPTO']

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type MonedaFacturaDirecta = 'ARS' | 'USD'
export type LetraFacturaDirecta = 'A' | 'B'

export interface LineaFacturaDirecta {
  /** Producto del ERP (null = texto libre) */
  productId: string | null
  descripcion: string
  cantidad: number
  /** Neto (A sin "precios con IVA") o final con IVA (B, o A con preciosConIva) */
  precioUnitario: number
  /** Sale impreso debajo de la descripción (N° de ítem de la OC, etc.) */
  comentario: string | null
}

/** Documento del comprador de una Factura B a consumidor final sin CUIT: DNI (96) o CUIL (86) */
export interface DocumentoReceptorB {
  docTipo: 96 | 86
  docNro: string
}

export interface PedidoFacturaDirecta {
  /** UUID del navegador: obligatorio en el POST de emisión, ignorado en la vista previa */
  idempotencyKey: string | null
  customerId: string
  moneda: MonedaFacturaDirecta
  /** Obligatorio en USD (ARS por USD); null en ARS */
  tipoCambio: number | null
  /** Clave de CONDICIONES_PAGO (condicion-pago.ts) */
  condicionPago: string
  /** En la B se fuerza true (precios finales) */
  preciosConIva: boolean
  documentoReceptorB: DocumentoReceptorB | null
  lineas: LineaFacturaDirecta[]
  observaciones: string | null
  /** Venta de ML a vincular (pack u order id): solo en ARS */
  mlVenta: string | null
  /** Firmas (ConfirmacionRequerida.firma) de las confirmaciones que el usuario tildó */
  confirmaciones: string[]
}

/** Error o aviso para mostrar (linea = 1..n si es de una línea) */
export interface ProblemaFacturaDirecta {
  codigo: string
  mensaje: string
  linea?: number
}

// ---------------------------------------------------------------------------
// Confirmaciones
// ---------------------------------------------------------------------------

/**
 * Texto por defecto de cada confirmación (el servidor puede devolver uno más
 * específico). Cada motivo de posible duplicado tiene su propio código: un
 * motivo nuevo nunca queda cubierto por el tilde de otro.
 */
export const CONFIRMACIONES_FACTURA_DIRECTA = {
  EMISION_IRREVERSIBLE: 'La factura se emite en ARCA y no se puede borrar: solo se anula con una nota de crédito.',
  TIPO_CAMBIO_ALEJADO: 'El tipo de cambio se aleja más de 3% del último dólar BNA cargado.',
  /** Factura del ERP del mismo cliente, misma moneda y mismo total en los últimos 7 días */
  POSIBLE_DUPLICADO: 'Puede ser una factura duplicada: hay otra factura del cliente por el mismo total.',
  /** Otra factura directa a este cliente hace menos de 10 minutos */
  DIRECTA_RECIENTE: 'Se emitió otra factura directa a este cliente hace menos de 10 minutos.',
  /** Factura del ERP (de cualquier cliente) por el total de la venta de ML */
  POSIBLE_DUPLICADO_ML: 'Ya hay una factura del ERP por el total de la venta de Mercado Libre.',
  ML_FACTURA_ADJUNTA: 'La venta de Mercado Libre ya tiene una factura adjunta.',
  ML_FACTURA_SIN_VERIFICAR: 'Mercado Libre no pudo confirmar si la venta ya tiene una factura adjunta.',
  ML_TOTAL_DISTINTO: 'El total de la factura es distinto del cobrado en Mercado Libre.',
  ML_OTRO_TITULAR: 'El cliente no es el comprador que informa Mercado Libre.',
  /** RI/monotributo en el ERP pero ARCA no informa la condición (constancia con observaciones) */
  CONDICION_IVA_SIN_CONFIRMAR: 'ARCA no confirma la condición frente al IVA del cliente: se factura con la del ERP.',
} as const

export type CodigoConfirmacion = keyof typeof CONFIRMACIONES_FACTURA_DIRECTA

export interface ConfirmacionRequerida {
  codigo: CodigoConfirmacion
  mensaje: string
  /**
   * `CODIGO:hash del mensaje` (firmaConfirmacion): es lo que el navegador
   * devuelve al tildarla. Ata el tilde a lo que se mostró: si al emitir el
   * motivo cambió (apareció otro duplicado, cambió el dólar de referencia,
   * otro comprador en ML...), la firma cambia y se vuelve a pedir (409).
   */
  firma: string
}

export function esCodigoConfirmacion(c: unknown): c is CodigoConfirmacion {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(CONFIRMACIONES_FACTURA_DIRECTA, c)
}

/** Hash de 53 bits (cyrb53) en hex: sin dependencias, igual en el navegador y en el servidor. No es criptográfico. */
function hash53(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/** Firma de una confirmación: el código y un hash del texto que se muestra */
export function firmaConfirmacion(codigo: string, mensaje: string): string {
  return `${codigo}:${hash53(`${codigo}\n${mensaje}`)}`
}

/** Código de una firma de confirmación ("POSIBLE_DUPLICADO:1a2b…" → "POSIBLE_DUPLICADO") */
export function codigoDeFirma(firma: string): string {
  const i = firma.indexOf(':')
  return i >= 0 ? firma.slice(0, i) : firma
}

/** Confirmación con su firma (el mensaje por defecto si no se pasa uno) */
export function crearConfirmacion(codigo: CodigoConfirmacion, mensaje?: string): ConfirmacionRequerida {
  const m = mensaje ?? CONFIRMACIONES_FACTURA_DIRECTA[codigo]
  return { codigo, mensaje: m, firma: firmaConfirmacion(codigo, m) }
}

/**
 * Las requeridas que el usuario no tildó. `dadas` son FIRMAS (no códigos):
 * un código suelto, o la firma de un texto que ya no es el que se pide,
 * no confirma nada.
 */
export function confirmacionesFaltantes(requeridas: ConfirmacionRequerida[], dadas: readonly string[]): ConfirmacionRequerida[] {
  const set = new Set(dadas)
  return requeridas.filter((r) => !set.has(r.firma))
}

// ---------------------------------------------------------------------------
// Parseo del pedido (estructura → 400)
// ---------------------------------------------------------------------------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Número de un campo del pedido: número JSON o texto en formato argentino ("1.234,56"). NaN si no es número. */
export function numeroFacturaDirecta(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return parseNumeroAr(v)
  return NaN
}

const texto = (v: unknown) => (typeof v === 'string' ? v : '')
const textoOpcional = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

/**
 * Valida la ESTRUCTURA del pedido (tipos, claves conocidas) y lo normaliza.
 * Los errores de acá son un 400 (body mal formado). Las reglas de negocio
 * (cantidades, precios, totales, documento, ...) se validan después
 * (validarLineasFacturaDirecta, calcularFacturaDirecta y el servidor): 422.
 */
export function validarPedidoFacturaDirecta(
  body: unknown,
  opts: { requiereClave?: boolean } = {}
): { pedido: PedidoFacturaDirecta | null; errores: string[] } {
  const errores: string[] = []
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { pedido: null, errores: ['Pedido vacío o inválido'] }
  const b = body as Record<string, unknown>

  let idempotencyKey: string | null = null
  if (typeof b.idempotencyKey === 'string' && UUID_REGEX.test(b.idempotencyKey.trim())) idempotencyKey = b.idempotencyKey.trim().toLowerCase()
  else if (opts.requiereClave) errores.push('idempotencyKey tiene que ser un UUID')

  const customerId = typeof b.customerId === 'string' ? b.customerId.trim() : ''
  if (!customerId || customerId.length > 64) errores.push('Falta el cliente (customerId)')

  if (b.moneda !== 'ARS' && b.moneda !== 'USD') errores.push('moneda tiene que ser "ARS" o "USD"')
  const moneda: MonedaFacturaDirecta = b.moneda === 'USD' ? 'USD' : 'ARS'

  let tipoCambio: number | null = null
  if (b.tipoCambio !== undefined && b.tipoCambio !== null && b.tipoCambio !== '') {
    if (typeof b.tipoCambio !== 'number' && typeof b.tipoCambio !== 'string') errores.push('tipoCambio tiene que ser un número')
    else tipoCambio = numeroFacturaDirecta(b.tipoCambio)
  }
  if (moneda === 'ARS') tipoCambio = null

  if (!esCondicionPago(b.condicionPago)) errores.push('condicionPago no es una condición de pago válida')

  if (b.preciosConIva !== undefined && typeof b.preciosConIva !== 'boolean') errores.push('preciosConIva tiene que ser true o false')

  let documentoReceptorB: DocumentoReceptorB | null = null
  if (b.documentoReceptorB !== undefined && b.documentoReceptorB !== null) {
    const d = b.documentoReceptorB as Record<string, unknown>
    const docTipo = Number(d && typeof d === 'object' ? d.docTipo : NaN)
    const docNro = d && typeof d === 'object' && (typeof d.docNro === 'string' || typeof d.docNro === 'number') ? String(d.docNro).replace(/\D/g, '') : ''
    if (docTipo !== 96 && docTipo !== 86) errores.push('documentoReceptorB.docTipo tiene que ser 96 (DNI) u 86 (CUIL)')
    else documentoReceptorB = { docTipo, docNro }
  }

  if (!Array.isArray(b.lineas)) errores.push('lineas tiene que ser una lista')
  else if (b.lineas.length > 500) errores.push('Demasiadas líneas')
  const lineas: LineaFacturaDirecta[] = (Array.isArray(b.lineas) ? b.lineas.slice(0, 500) : []).map((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errores.push(`lineas[${i}] tiene que ser un objeto`)
      return { productId: null, descripcion: '', cantidad: NaN, precioUnitario: NaN, comentario: null }
    }
    const l = raw as Record<string, unknown>
    if (l.productId !== undefined && l.productId !== null && typeof l.productId !== 'string') errores.push(`lineas[${i}].productId tiene que ser texto`)
    if (l.descripcion !== undefined && typeof l.descripcion !== 'string') errores.push(`lineas[${i}].descripcion tiene que ser texto`)
    if (typeof l.cantidad !== 'number' && typeof l.cantidad !== 'string') errores.push(`lineas[${i}].cantidad tiene que ser un número`)
    if (typeof l.precioUnitario !== 'number' && typeof l.precioUnitario !== 'string') errores.push(`lineas[${i}].precioUnitario tiene que ser un número`)
    if (l.comentario !== undefined && l.comentario !== null && typeof l.comentario !== 'string') errores.push(`lineas[${i}].comentario tiene que ser texto`)
    return {
      productId: typeof l.productId === 'string' && l.productId.trim() ? l.productId.trim() : null,
      descripcion: texto(l.descripcion).replace(/\s+/g, ' ').trim(),
      cantidad: numeroFacturaDirecta(l.cantidad),
      precioUnitario: numeroFacturaDirecta(l.precioUnitario),
      comentario: textoOpcional(l.comentario),
    }
  })

  if (b.observaciones !== undefined && b.observaciones !== null && typeof b.observaciones !== 'string') errores.push('observaciones tiene que ser texto')

  let mlVenta: string | null = null
  if (b.mlVenta !== undefined && b.mlVenta !== null && b.mlVenta !== '') {
    const v = String(b.mlVenta).trim()
    if ((typeof b.mlVenta !== 'string' && typeof b.mlVenta !== 'number') || !/^\d{1,20}$/.test(v)) errores.push('mlVenta tiene que ser el número de la venta (pack u orden)')
    else mlVenta = v
  }

  let confirmaciones: string[] = []
  if (b.confirmaciones !== undefined && b.confirmaciones !== null) {
    if (!Array.isArray(b.confirmaciones) || b.confirmaciones.some((c) => typeof c !== 'string')) errores.push('confirmaciones tiene que ser una lista de códigos')
    else confirmaciones = Array.from(new Set(b.confirmaciones as string[]))
  }

  return {
    pedido: errores.length
      ? null
      : {
          idempotencyKey,
          customerId,
          moneda,
          tipoCambio,
          condicionPago: b.condicionPago as string,
          preciosConIva: b.preciosConIva === true,
          documentoReceptorB,
          lineas,
          observaciones: textoOpcional(b.observaciones),
          mlVenta,
          confirmaciones,
        },
    errores,
  }
}

// ---------------------------------------------------------------------------
// Validaciones de negocio puras (422)
// ---------------------------------------------------------------------------

/** true si tiene a lo sumo 2 decimales (centavos) */
export function hastaDosDecimales(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6
}

/** Líneas: 1 a 50, descripción, cantidad y precio > 0 con hasta 2 decimales. */
export function validarLineasFacturaDirecta(
  lineas: Array<Pick<LineaFacturaDirecta, 'descripcion' | 'cantidad' | 'precioUnitario'> & { comentario?: string | null }>
): ProblemaFacturaDirecta[] {
  const out: ProblemaFacturaDirecta[] = []
  if (!lineas.length) return [{ codigo: 'SIN_LINEAS', mensaje: 'Agregá al menos una línea' }]
  if (lineas.length > MAX_LINEAS_FACTURA_DIRECTA) {
    out.push({ codigo: 'DEMASIADAS_LINEAS', mensaje: `La factura admite hasta ${MAX_LINEAS_FACTURA_DIRECTA} líneas (tiene ${lineas.length})` })
  }
  lineas.forEach((l, i) => {
    const linea = i + 1
    const desc = String(l.descripcion ?? '').trim()
    if (!desc) out.push({ codigo: 'DESCRIPCION_INVALIDA', mensaje: `Línea ${linea}: falta la descripción`, linea })
    else if (desc.length > MAX_DESCRIPCION_LINEA) {
      out.push({ codigo: 'DESCRIPCION_INVALIDA', mensaje: `Línea ${linea}: la descripción supera ${MAX_DESCRIPCION_LINEA} caracteres`, linea })
    }
    const cantidad = Number(l.cantidad)
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > MAX_CANTIDAD) {
      out.push({ codigo: 'CANTIDAD_INVALIDA', mensaje: `Línea ${linea}: la cantidad tiene que ser mayor a cero`, linea })
    } else if (!hastaDosDecimales(cantidad)) {
      out.push({ codigo: 'CANTIDAD_INVALIDA', mensaje: `Línea ${linea}: la cantidad admite hasta 2 decimales`, linea })
    }
    const precio = Number(l.precioUnitario)
    if (!Number.isFinite(precio) || precio <= 0 || precio > MAX_PRECIO) {
      out.push({ codigo: 'PRECIO_INVALIDO', mensaje: `Línea ${linea}: el precio tiene que ser mayor a cero`, linea })
    } else if (!hastaDosDecimales(precio)) {
      out.push({ codigo: 'PRECIO_INVALIDO', mensaje: `Línea ${linea}: el precio admite hasta 2 decimales`, linea })
    }
    if ((l.comentario ?? '').length > MAX_COMENTARIO_LINEA) {
      out.push({ codigo: 'COMENTARIO_LARGO', mensaje: `Línea ${linea}: el comentario supera ${MAX_COMENTARIO_LINEA} caracteres`, linea })
    }
  })
  return out
}

/**
 * Cliente que no se factura desde esta pantalla: del exterior (va con Factura
 * E desde la cotización) o con una condición IVA vieja que no discrimina IVA.
 */
export function bloqueoClienteFacturaDirecta(c: {
  taxCondition: string | null | undefined
  cuit?: string | null
  country?: string | null
}): ProblemaFacturaDirecta | null {
  if (esClienteExterior({ taxCondition: c.taxCondition, country: c.country }) || /^[A-Z]{2}-/.test(c.cuit ?? '')) {
    return {
      codigo: 'CLIENTE_EXTERIOR',
      mensaje: 'Cliente del exterior: se factura con Factura E de exportación desde la cotización (botón «Emitir Factura E»), no desde acá',
    }
  }
  if (CONDICIONES_NO_SOPORTADAS.includes(c.taxCondition ?? '')) {
    return {
      codigo: 'CONDICION_NO_SOPORTADA',
      mensaje: 'La condición IVA del cliente (no inscripto / no responsable) no se factura desde acá: corregila en el cliente según su constancia de ARCA',
    }
  }
  return null
}

/** Documento del receptor que irá a ARCA (= receptorDesdeCondicion de emitir.ts + documentoReceptorB del hook). */
export function docTipoReceptorPrevisto(
  taxCondition: string | null | undefined,
  cuit: string | null | undefined,
  documentoReceptorB?: DocumentoReceptorB | null
): number {
  if (letraFacturaColppy(taxCondition) === 'A') return 80
  if (documentoReceptorB) return documentoReceptorB.docTipo
  const d = String(cuit ?? '').replace(/\D/g, '')
  if (d.length === 11) return 80
  if (d.length >= 7 && d.length <= 8) return 96
  return 99
}

/** Documento de la B: DNI de 7-8 dígitos o CUIL con dígito verificador válido */
export function validarDocumentoReceptorB(d: DocumentoReceptorB): ProblemaFacturaDirecta | null {
  const nro = String(d.docNro ?? '').replace(/\D/g, '')
  if (d.docTipo === 96 && nro.length >= 7 && nro.length <= 8 && !/^0+$/.test(nro)) return null
  if (d.docTipo === 86 && esCuitValido(nro)) return null
  return {
    codigo: 'DOC_INVALIDO',
    mensaje: d.docTipo === 96 ? `El DNI ${nro || '(vacío)'} no es válido (7 u 8 dígitos)` : `El CUIL ${nro || '(vacío)'} no es válido (dígito verificador)`,
  }
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

export interface EntradaCalculoFacturaDirecta {
  taxCondition: string | null | undefined
  cuit?: string | null
  country?: string | null
  fceObligado?: boolean
  lineas: Array<Pick<LineaFacturaDirecta, 'descripcion' | 'cantidad' | 'precioUnitario'> & { comentario?: string | null }>
  moneda: MonedaFacturaDirecta
  tipoCambio: number | null | undefined
  preciosConIva: boolean
  /** Umbral FCE en ARS (getArcaConfig().fceMontoMinimo) */
  fceMontoMinimo: number
  documentoReceptorB?: DocumentoReceptorB | null
  /** DocTipo del receptor en ARCA (el servidor lo saca de receptorDesdeCondicion); default docTipoReceptorPrevisto */
  docTipoReceptor?: number
  /** false = falta ARCA_CBU (no se puede emitir una FCE); undefined = no se sabe (pantalla) */
  cbuConfigurado?: boolean
}

export interface TotalesFacturaDirecta {
  neto: number
  iva: number
  total: number
  /** Total en pesos (USD × tipo de cambio, redondeado) */
  totalArs: number
}

export interface CalculoFacturaDirecta {
  letra: LetraFacturaDirecta
  esFce: boolean
  /** 1 Factura A, 6 Factura B, 201 FCE A */
  cbteTipoPrevisto: 1 | 6 | 201
  /** Efectivo: en la B siempre true */
  preciosConIva: boolean
  docTipoReceptor: number
  totales: TotalesFacturaDirecta
  errores: ProblemaFacturaDirecta[]
  avisos: ProblemaFacturaDirecta[]
}

const round2 = (n: number) => Math.round(n * 100) / 100
const fmtArs = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** true si el TC tiene a lo sumo 4 decimales (FacturaDirecta.exchangeRate es Decimal(12,4)) */
function hastaCuatroDecimales(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n * 10000 - Math.round(n * 10000)) < 1e-6
}

/**
 * Letra, totales (las mismas funciones que sendQuoteToColppy), FCE y las
 * validaciones que no necesitan base de datos. Las líneas inválidas no suman
 * (para que la pantalla muestre totales parciales), pero dan error.
 */
export function calcularFacturaDirecta(e: EntradaCalculoFacturaDirecta): CalculoFacturaDirecta {
  const errores: ProblemaFacturaDirecta[] = []
  const avisos: ProblemaFacturaDirecta[] = []
  const letra = letraFacturaColppy(e.taxCondition)
  const preciosConIva = letra === 'B' ? true : e.preciosConIva
  const docTipoReceptor = e.docTipoReceptor ?? docTipoReceptorPrevisto(e.taxCondition, e.cuit, e.documentoReceptorB)

  const bloqueo = bloqueoClienteFacturaDirecta(e)
  if (bloqueo) errores.push(bloqueo)

  const erroresLineas = validarLineasFacturaDirecta(e.lineas)
  errores.push(...erroresLineas)

  const esUsd = e.moneda === 'USD'
  const tc = esUsd ? Number(e.tipoCambio) : 1
  const tcValido = !esUsd || (Number.isFinite(tc) && tc >= TIPO_CAMBIO_MIN && tc <= TIPO_CAMBIO_MAX && hastaCuatroDecimales(tc))
  if (!tcValido) {
    errores.push({
      codigo: 'TIPO_CAMBIO_INVALIDO',
      mensaje: `En dólares hace falta el tipo de cambio (entre ${TIPO_CAMBIO_MIN} y ${TIPO_CAMBIO_MAX.toLocaleString('es-AR')}, hasta 4 decimales)`,
    })
  }

  // Mismos cálculos que sendQuoteToColppy con bonificación 0 (líneas válidas)
  const validas = e.lineas
    .map((l) => ({ cantidad: Number(l.cantidad), precioUnitario: Number(l.precioUnitario) }))
    .filter((l) => Number.isFinite(l.cantidad) && Number.isFinite(l.precioUnitario) && l.cantidad > 0 && l.precioUnitario > 0)
  let neto: number
  let iva: number
  let total: number
  if (letra === 'B') {
    const b = totalesFacturaB(validas.map((l) => ({ cantidad: l.cantidad, precioFinal: l.precioUnitario })), 0)
    ;({ neto, iva, total } = b)
  } else {
    const a = totalesFacturaA(validas, 0, preciosConIva)
    ;({ neto, iva, total } = a)
  }
  const totalArs = esUsd ? (tcValido ? round2(total * tc) : NaN) : total

  if (!erroresLineas.length && !(neto > 0 && iva > 0 && total > 0 && Number.isFinite(neto + iva + total))) {
    errores.push({ codigo: 'TOTAL_INVALIDO', mensaje: `Total inválido: neto ${neto}, IVA ${iva}, total ${total} (tienen que ser mayores a cero)` })
  } else if (total > MAX_TOTAL || (Number.isFinite(totalArs) && totalArs > MAX_TOTAL)) {
    errores.push({ codigo: 'TOTAL_INVALIDO', mensaje: 'El total supera el máximo admitido' })
  }

  // Factura B a consumidor final sin identificar ≥ umbral (RG 5866)
  if (letra === 'B' && docTipoReceptor === 99 && Number.isFinite(totalArs) && totalArs >= UMBRAL_IDENTIFICACION_CF) {
    errores.push({
      codigo: 'DOC_REQUERIDO_CF',
      mensaje: `Una Factura B a consumidor final de $ ${fmtArs(UMBRAL_IDENTIFICACION_CF)} o más tiene que identificar al comprador (RG 5866): indicá su DNI o CUIL`,
    })
  }
  if (letra === 'B' && e.documentoReceptorB) {
    const d = validarDocumentoReceptorB(e.documentoReceptorB)
    if (d) errores.push(d)
  }

  // FCE MiPyME: misma regla que el hook de ARCA (crearHookEmisionArca)
  const totalParaFce = esUsd ? total * tc : total
  const esFce = !!e.fceObligado && letra === 'A' && Number.isFinite(totalParaFce) && totalParaFce >= e.fceMontoMinimo
  if (esFce) {
    if (e.cbuConfigurado === false) {
      errores.push({
        codigo: 'FCE_SIN_CBU',
        mensaje: 'El cliente está obligado a FCE MiPyME y el total supera el umbral, pero falta configurar ARCA_CBU en el servidor',
      })
    } else {
      avisos.push({
        codigo: 'SALE_COMO_FCE',
        mensaje: `Sale como FCE MiPyME A: el cliente está obligado y el total (ARS ${fmtArs(round2(totalParaFce))}) supera el umbral (ARS ${fmtArs(e.fceMontoMinimo)})`,
      })
    }
  }

  if (letra === 'B' && !e.preciosConIva) {
    avisos.push({ codigo: 'PRECIOS_FINALES', mensaje: 'En la Factura B los precios se cargan finales (IVA incluido)' })
  }
  avisos.push({
    codigo: 'SIN_COMISION',
    mensaje: 'La factura directa no genera comisión: si corresponde, cargala como venta manual en Comisiones',
  })

  return {
    letra,
    esFce,
    cbteTipoPrevisto: esFce ? 201 : letra === 'A' ? 1 : 6,
    preciosConIva,
    docTipoReceptor,
    totales: { neto, iva, total, totalArs },
    errores,
    avisos,
  }
}

/** El TC se aleja de la referencia (último BNA billete) más que la tolerancia */
export function tipoCambioAlejado(tc: number, referencia: number | null | undefined, tolerancia = TOLERANCIA_TIPO_CAMBIO): boolean {
  const ref = Number(referencia)
  if (!Number.isFinite(ref) || ref <= 0 || !Number.isFinite(tc)) return false
  return Math.abs(tc - ref) / ref > tolerancia
}

// ---------------------------------------------------------------------------
// Fechas y datos para ARCA
// ---------------------------------------------------------------------------

/** YYYY-MM-DD en hora de Buenos Aires */
export function fechaYmdAr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** YYYY-MM-DD en hora local del proceso (= la que usa toCbteFch para CbteFch) */
export function fechaYmdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** YYYY-MM-DD → Date a las 12:00 locales (fecha de una factura emitida otro día) */
export function fechaDesdeYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0)
}

/**
 * Fecha del comprobante que va al hook de ARCA: el día local de `ahora` a las
 * 12:00 (no la hora real). Así toCbteFch (CbteFch), el FchVtoPago de la FCE y
 * el QR (buildQrUrl usa toISOString, en UTC) dan el mismo día: con la hora
 * real, de 21 a 24 h de Argentina el QR salía con el día siguiente.
 */
export function fechaComprobanteDirecta(ahora: Date): Date {
  return fechaDesdeYmd(fechaYmdLocal(ahora))
}

/**
 * Datos que recibe el hook de ARCA (crearHookEmisionArca(...).hook): los
 * mismos campos que arma sendQuoteToColppy para la emisión externa.
 */
export function datosEmisionFacturaDirecta(
  calculo: Pick<CalculoFacturaDirecta, 'letra' | 'totales'>,
  p: { moneda: MonedaFacturaDirecta; tipoCambio: number | null; condicionPago: string; fecha: Date; descripcion: string }
): EmisionExternaDatos {
  return {
    tipoFactura: calculo.letra,
    netoGravado: calculo.totales.neto,
    totalIVA: calculo.totales.iva,
    totalFactura: calculo.totales.total,
    currency: p.moneda,
    exchangeRate: p.moneda === 'USD' ? Number(p.tipoCambio) : null,
    fechaFactura: p.fecha,
    fechaVto: fechaVtoDesde(p.fecha, p.condicionPago),
    idCondicionPago: p.condicionPago,
    descripcion: p.descripcion,
  }
}

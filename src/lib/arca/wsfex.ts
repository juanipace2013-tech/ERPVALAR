/**
 * WSFEX v1 — Web Service de Facturación Electrónica de EXPORTACIÓN de ARCA
 * (Factura E 19, Nota de Débito E 20, Nota de Crédito E 21). Cliente SOAP
 * mínimo con el mismo enfoque que wsfe.ts: XML a mano, fast-xml-parser y
 * transporte por postSoap (agente TLS propio de ARCA).
 *
 * Diferencias con WSFEv1 que importan:
 *  - Namespace http://ar.gov.afip.dif.fexv1/ y ticket WSAA del servicio "wsfex".
 *  - Errores en FEXErr {ErrCode, ErrMsg} y eventos en FEXEvents {EventCode,
 *    EventMsg}; el código 0 significa "sin error / sin evento" y se ignora.
 *  - FEXGetLast_CMP lleva Pto_venta y Cbte_Tipo DENTRO de <Auth>.
 *  - FEXAuthorize es idempotente por Cmp.Id: reenviar el MISMO Id devuelve lo
 *    que ARCA ya guardó con Reproceso = 'S' (no autoriza dos veces).
 *  - FEXGetPARAM_Ctz pide la fecha como YYYY-MM-DD (el resto usa yyyymmdd).
 *
 * Orden y nombres de los elementos según el WSDL de wsfexv1 (ClsFEXRequest).
 * La emisión con idempotencia y validaciones está en emitir-exportacion.ts.
 */
import { XMLParser } from 'fast-xml-parser'
import { getArcaConfig } from './config'
import { getTicketAcceso } from './wsaa'
import { postSoap } from './http'
import { ArcaError, type ArcaObservacion } from './wsfe'

export const FEX_NS = 'http://ar.gov.afip.dif.fexv1/'

/** Códigos de FEXErr con tratamiento propio */
export const FEX_ERR = {
  /** FEXGetCMP: no existe el comprobante pedido (según el manual; no visto en vivo) */
  CMP_INEXISTENTE: 1020,
  /** FEXGetPARAM_Ctz: "Codigo de moneda (DOL) inexistente o SIN cotización" (visto en prod 2/10/2026) */
  SIN_COTIZACION: 1800,
} as const

/**
 * Errores internos de ARCA (aplicación / base de datos / transacción): NO son
 * un rechazo del comprobante por sus datos, así que el resultado se confirma
 * con FEXGetCMP antes de darlo por rechazado.
 */
export const FEX_ERR_TRANSITORIOS: ReadonlySet<number> = new Set([500, 501, 502])

// ---------------------------------------------------------------------------
// Tipos del request (nombres = elementos del XSD)
// ---------------------------------------------------------------------------

export interface FexPermiso {
  Id_permiso: string
  Dst_merc: number
}

export interface FexCmpAsoc {
  Cbte_tipo: number
  Cbte_punto_vta: number
  Cbte_nro: number
  Cbte_cuit: string
}

export interface FexItem {
  Pro_codigo?: string
  Pro_ds: string
  Pro_qty: number
  Pro_umed: number
  /** USD, hasta 6 decimales */
  Pro_precio_uni: number
  /** MONTO de la bonificación (no porcentaje) */
  Pro_bonificacion: number
  Pro_total_item: number
}

export interface FexOpcional {
  Id: string
  Valor: string
}

export interface FexActividad {
  Id: number
}

/** Cmp de FEXAuthorize (ClsFEXRequest). Los importes se formatean al serializar. */
export interface FexCmp {
  Id: number
  Fecha_cbte: string // yyyymmdd
  Cbte_Tipo: number
  Punto_vta: number
  Cbte_nro: number
  Tipo_expo: number
  /** 'S' | 'N' en facturas de bienes; vacío en NC/ND y servicios */
  Permiso_existente?: 'S' | 'N' | ''
  Permisos?: FexPermiso[]
  Dst_cmp: number
  Cliente: string
  /** CUIT país genérico; si falta se manda 0 (el elemento es obligatorio en el XSD) */
  Cuit_pais_cliente?: string
  Domicilio_cliente: string
  Id_impositivo?: string
  Moneda_Id: string
  Moneda_ctz: number
  CanMisMonExt?: 'S' | 'N'
  Obs_comerciales?: string
  Imp_total: number
  Obs?: string
  Cmps_asoc?: FexCmpAsoc[]
  Forma_pago?: string
  Incoterms?: string
  Incoterms_Ds?: string
  Idioma_cbte: number
  Items: FexItem[]
  Opcionales?: FexOpcional[]
  Fecha_pago?: string // yyyymmdd
  Actividades?: FexActividad[]
}

// ---------------------------------------------------------------------------
// Tipos de respuesta
// ---------------------------------------------------------------------------

export interface FexAuthorizeResult {
  Id: number
  Cuit: string
  Cbte_tipo: number
  Punto_vta: number
  Cbte_nro: number
  Cae: string
  Fch_venc_Cae: string // yyyymmdd
  Fch_cbte: string // yyyymmdd
  /** 'A' aprobado, 'R' rechazado, '' si ARCA no devolvió FEXResultAuth */
  Resultado: string
  /** true si ARCA devolvió lo ya procesado para ese Id (Reproceso = 'S') */
  Reproceso: boolean
  Motivos_Obs: string
  /** FEXErr con código distinto de 0 */
  errores: ArcaObservacion[]
  /** FEXEvents con código distinto de 0 */
  eventos: ArcaObservacion[]
  raw: unknown
}

/** Comprobante leído con FEXGetCMP (ClsFEXGetCMPR, subset útil) */
export interface FexCmpConsultado {
  Id: number
  Fecha_cbte: string
  Cbte_tipo: number
  Punto_vta: number
  Cbte_nro: number
  Tipo_expo: number
  Permiso_existente: string
  Dst_cmp: number
  Cliente: string
  Cuit_pais_cliente: string
  Domicilio_cliente: string
  Id_impositivo: string
  Moneda_Id: string
  Moneda_ctz: number
  CanMisMonExt: string
  Imp_total: number
  Forma_pago: string
  Incoterms: string
  Incoterms_Ds: string
  Idioma_cbte: number
  Items: FexItem[]
  Opcionales: FexOpcional[]
  Fecha_cbte_cae: string
  Fch_venc_Cae: string
  Cae: string
  Resultado: string
  Motivos_Obs: string
  raw: unknown
}

export interface FexCotizacionResult {
  monCtz: number
  /** Fecha de la cotización tal como la informa ARCA (Mon_fecha) */
  monFecha: string
}

export interface CotizacionFex {
  monId: string
  cotizacion: number
  /** Fecha (YYYY-MM-DD) con la que se consultó y ARCA respondió */
  fechaConsultada: string
  /** Fecha de la cotización según ARCA (Mon_fecha) o la consultada si no vino */
  fechaCotizacion: string
  /** 0 = la fecha pedida; 1 = un día antes; ... */
  diasAtras: number
}

/** SOAP Fault: ARCA respondió y terminó de procesar, pero con una excepción. */
export class FexFaultError extends ArcaError {
  constructor(message: string, raw?: unknown) {
    super(message, [], [], raw)
    this.name = 'FexFaultError'
  }
}

// ---------------------------------------------------------------------------
// Helpers de XML (copia mínima de wsfe.ts; los nombres de hijos son otros)
// ---------------------------------------------------------------------------

function esc(v: unknown): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function tag(name: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  return `<ar:${name}>${esc(value)}</ar:${name}>`
}

function ensureArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

function dig(o: unknown, keys: string[]): unknown {
  let cur: unknown = o
  for (const k of keys) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function str(v: unknown): string {
  if (v === undefined || v === null || typeof v === 'object') return ''
  return String(v).trim()
}

function num(v: unknown): number {
  const s = str(v)
  if (!s) return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * Número decimal para el XML: redondeado a `max` decimales, sin ceros de más
 * pero con al menos `min` decimales, nunca en notación exponencial.
 *   fmtDecimal(2078.88, 2, 2) → "2078.88"; fmtDecimal(3, 6) → "3"; fmtDecimal(120, 6, 2) → "120.00"
 */
export function fmtDecimal(n: number, max: number, min = 0): string {
  if (!Number.isFinite(n)) throw new Error(`Valor numérico inválido para ARCA: ${n}`)
  const s = n.toFixed(max)
  if (!s.includes('.')) return s
  const [ent, dec] = s.split('.')
  let d = dec.replace(/0+$/, '')
  if (d.length < min) d = d.padEnd(min, '0')
  return d.length ? `${ent}.${d}` : ent
}

/** Nombre EXPLÍCITO del elemento hijo de cada lista (quitar la "s" daría "Cmps_aso" y "Opcionale"). */
export const FEX_HIJOS = {
  Permisos: 'Permiso',
  Cmps_asoc: 'Cmp_asoc',
  Items: 'Item',
  Opcionales: 'Opcional',
  Actividades: 'Actividad',
} as const

function lista<T>(nombre: keyof typeof FEX_HIJOS, items: T[] | undefined, serializar: (it: T) => string): string {
  if (!items || items.length === 0) return ''
  const hijo = FEX_HIJOS[nombre]
  return `<ar:${nombre}>${items.map((it) => `<ar:${hijo}>${serializar(it)}</ar:${hijo}>`).join('')}</ar:${nombre}>`
}

/** Orden de los elementos de Cmp según el XSD (ClsFEXRequest). */
export const FEX_CMP_ORDEN = [
  'Id',
  'Fecha_cbte',
  'Cbte_Tipo',
  'Punto_vta',
  'Cbte_nro',
  'Tipo_expo',
  'Permiso_existente',
  'Permisos',
  'Dst_cmp',
  'Cliente',
  'Cuit_pais_cliente',
  'Domicilio_cliente',
  'Id_impositivo',
  'Moneda_Id',
  'Moneda_ctz',
  'CanMisMonExt',
  'Obs_comerciales',
  'Imp_total',
  'Obs',
  'Cmps_asoc',
  'Forma_pago',
  'Incoterms',
  'Incoterms_Ds',
  'Idioma_cbte',
  'Items',
  'Opcionales',
  'Fecha_pago',
  'Actividades',
] as const satisfies readonly (keyof FexCmp)[]

/**
 * Serializa el Cmp de FEXAuthorize (`<ar:Cmp>…</ar:Cmp>`) en el orden del XSD.
 * PURA: el mismo Cmp da siempre el mismo XML, que es lo que se reenvía tal
 * cual ante un corte (mismo Id). Omite los opcionales vacíos; los
 * obligatorios del XSD van siempre.
 */
export function buildFexAuthorizeBody(cmp: FexCmp): string {
  const partes: Record<(typeof FEX_CMP_ORDEN)[number], string> = {
    Id: tag('Id', cmp.Id),
    Fecha_cbte: tag('Fecha_cbte', cmp.Fecha_cbte),
    Cbte_Tipo: tag('Cbte_Tipo', cmp.Cbte_Tipo),
    Punto_vta: tag('Punto_vta', cmp.Punto_vta),
    Cbte_nro: tag('Cbte_nro', cmp.Cbte_nro),
    Tipo_expo: tag('Tipo_expo', cmp.Tipo_expo),
    Permiso_existente: tag('Permiso_existente', cmp.Permiso_existente),
    Permisos: lista('Permisos', cmp.Permisos, (p) => tag('Id_permiso', p.Id_permiso) + tag('Dst_merc', p.Dst_merc)),
    Dst_cmp: tag('Dst_cmp', cmp.Dst_cmp),
    Cliente: tag('Cliente', cmp.Cliente),
    // Obligatorio en el XSD (long): sin CUIT país se manda 0 (lo mismo que haría ARCA si faltara)
    Cuit_pais_cliente: tag('Cuit_pais_cliente', cmp.Cuit_pais_cliente || '0'),
    Domicilio_cliente: tag('Domicilio_cliente', cmp.Domicilio_cliente),
    Id_impositivo: tag('Id_impositivo', cmp.Id_impositivo),
    Moneda_Id: tag('Moneda_Id', cmp.Moneda_Id),
    Moneda_ctz: tag('Moneda_ctz', fmtDecimal(cmp.Moneda_ctz, 6)),
    CanMisMonExt: tag('CanMisMonExt', cmp.CanMisMonExt),
    Obs_comerciales: tag('Obs_comerciales', cmp.Obs_comerciales),
    Imp_total: tag('Imp_total', fmtDecimal(cmp.Imp_total, 2, 2)),
    Obs: tag('Obs', cmp.Obs),
    Cmps_asoc: lista(
      'Cmps_asoc',
      cmp.Cmps_asoc,
      (c) =>
        tag('Cbte_tipo', c.Cbte_tipo) +
        tag('Cbte_punto_vta', c.Cbte_punto_vta) +
        tag('Cbte_nro', c.Cbte_nro) +
        tag('Cbte_cuit', c.Cbte_cuit)
    ),
    Forma_pago: tag('Forma_pago', cmp.Forma_pago),
    Incoterms: tag('Incoterms', cmp.Incoterms),
    Incoterms_Ds: tag('Incoterms_Ds', cmp.Incoterms_Ds),
    Idioma_cbte: tag('Idioma_cbte', cmp.Idioma_cbte),
    Items: lista(
      'Items',
      cmp.Items,
      (it) =>
        tag('Pro_codigo', it.Pro_codigo) +
        tag('Pro_ds', it.Pro_ds) +
        tag('Pro_qty', fmtDecimal(it.Pro_qty, 6)) +
        tag('Pro_umed', it.Pro_umed) +
        tag('Pro_precio_uni', fmtDecimal(it.Pro_precio_uni, 6, 2)) +
        tag('Pro_bonificacion', fmtDecimal(it.Pro_bonificacion, 2, 2)) +
        tag('Pro_total_item', fmtDecimal(it.Pro_total_item, 2, 2))
    ),
    Opcionales: lista('Opcionales', cmp.Opcionales, (o) => tag('Id', o.Id) + tag('Valor', o.Valor)),
    Fecha_pago: tag('Fecha_pago', cmp.Fecha_pago),
    Actividades: lista('Actividades', cmp.Actividades, (a) => tag('Id', a.Id)),
  }
  return `<ar:Cmp>${FEX_CMP_ORDEN.map((k) => partes[k]).join('')}</ar:Cmp>`
}

/**
 * Bloque <Auth>. FEXGetLast_CMP lleva además Pto_venta y Cbte_Tipo ADENTRO
 * (ClsFEX_LastCMP), en ese orden después de Cuit.
 */
export function buildFexAuthXml(a: {
  token: string
  sign: string
  cuit: string
  Pto_venta?: number
  Cbte_Tipo?: number
}): string {
  return (
    `<ar:Auth>${tag('Token', a.token)}${tag('Sign', a.sign)}${tag('Cuit', a.cuit)}` +
    `${tag('Pto_venta', a.Pto_venta)}${tag('Cbte_Tipo', a.Cbte_Tipo)}</ar:Auth>`
  )
}

export function buildFexEnvelope(method: string, innerXml: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${FEX_NS}">` +
    `<soapenv:Header/><soapenv:Body><ar:${method}>${innerXml}</ar:${method}></soapenv:Body></soapenv:Envelope>`
  )
}

// ---------------------------------------------------------------------------
// Parseo de respuestas (puro, testeable con XML de ejemplo)
// ---------------------------------------------------------------------------

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false })

/**
 * Devuelve el `<{method}Result>` ya parseado. Lanza FexFaultError ante un
 * SOAP Fault y ArcaError si la respuesta no trae el resultado (HTML de un
 * proxy, cuerpo vacío...): en ese caso no se sabe si ARCA procesó el pedido.
 */
export function parseFexSoapResponse(method: string, text: string, httpStatus = 200): Record<string, unknown> {
  let doc: unknown
  try {
    doc = parser.parse(text)
  } catch {
    throw new ArcaError(`WSFEX ${method}: la respuesta no es XML (HTTP ${httpStatus})`, [], [], text.slice(0, 500))
  }
  const fault = dig(doc, ['Envelope', 'Body', 'Fault'])
  if (fault) {
    const f = esObjeto(fault) ? fault : {}
    throw new FexFaultError(`WSFEX ${method} fault: ${str(f.faultstring) || str(f.faultcode) || 'sin detalle'}`, text)
  }
  const result = dig(doc, ['Envelope', 'Body', `${method}Response`, `${method}Result`])
  if (!esObjeto(result)) {
    throw new ArcaError(`WSFEX ${method}: respuesta inesperada (HTTP ${httpStatus})`, [], [], text.slice(0, 500))
  }
  return result
}

/** FEXErr / FEXEvents con código distinto de 0 (el 0 es "OK"). */
export function parseFexErrores(result: Record<string, unknown>): {
  errores: ArcaObservacion[]
  eventos: ArcaObservacion[]
} {
  const errores = ensureArray(result.FEXErr)
    .filter(esObjeto)
    .map((e) => ({ Code: num(e.ErrCode), Msg: str(e.ErrMsg) }))
    .filter((e) => e.Code !== 0)
  const eventos = ensureArray(result.FEXEvents)
    .filter(esObjeto)
    .map((e) => ({ Code: num(e.EventCode), Msg: str(e.EventMsg) }))
    .filter((e) => e.Code !== 0)
  return { errores, eventos }
}

export function formatFexErrores(errores: ArcaObservacion[]): string {
  return errores.map((e) => `[${e.Code}] ${e.Msg}`).join(' · ')
}

export function parseFexAuthorizeResult(result: Record<string, unknown>): FexAuthorizeResult {
  const { errores, eventos } = parseFexErrores(result)
  const a = esObjeto(result.FEXResultAuth) ? result.FEXResultAuth : {}
  return {
    Id: num(a.Id),
    Cuit: str(a.Cuit),
    Cbte_tipo: num(a.Cbte_tipo),
    Punto_vta: num(a.Punto_vta),
    Cbte_nro: num(a.Cbte_nro),
    Cae: str(a.Cae),
    Fch_venc_Cae: str(a.Fch_venc_Cae),
    Fch_cbte: str(a.Fch_cbte),
    Resultado: str(a.Resultado).toUpperCase(),
    Reproceso: str(a.Reproceso).toUpperCase() === 'S',
    Motivos_Obs: str(a.Motivos_Obs),
    errores,
    eventos,
    raw: result,
  }
}

/** Sobre SOAP completo de FEXAuthorize → resultado tipado (no lanza ante 'R'). */
export function parseFexAuthorizeResponse(xml: string, httpStatus?: number): FexAuthorizeResult {
  return parseFexAuthorizeResult(parseFexSoapResponse('FEXAuthorize', xml, httpStatus))
}

function parseItems(v: unknown): FexItem[] {
  return ensureArray(dig(v, ['Item']))
    .filter(esObjeto)
    .map((it) => ({
      Pro_codigo: str(it.Pro_codigo) || undefined,
      Pro_ds: str(it.Pro_ds),
      Pro_qty: num(it.Pro_qty),
      Pro_umed: num(it.Pro_umed),
      Pro_precio_uni: num(it.Pro_precio_uni),
      Pro_bonificacion: num(it.Pro_bonificacion),
      Pro_total_item: num(it.Pro_total_item),
    }))
}

/** null si ARCA dice que el comprobante no existe (FEXErr 1020). */
export function parseFexGetCmpResult(result: Record<string, unknown>): FexCmpConsultado | null {
  const { errores } = parseFexErrores(result)
  if (errores.some((e) => e.Code === FEX_ERR.CMP_INEXISTENTE)) return null
  if (errores.length) {
    throw new ArcaError(`FEXGetCMP: ${formatFexErrores(errores)}`, errores, [], result)
  }
  const g = result.FEXResultGet
  if (!esObjeto(g)) {
    // Sin resultado ni error: no se puede afirmar que no exista
    throw new ArcaError('FEXGetCMP: respuesta sin FEXResultGet ni FEXErr', [], [], result)
  }
  return {
    Id: num(g.Id),
    Fecha_cbte: str(g.Fecha_cbte),
    Cbte_tipo: num(g.Cbte_tipo),
    Punto_vta: num(g.Punto_vta),
    Cbte_nro: num(g.Cbte_nro),
    Tipo_expo: num(g.Tipo_expo),
    Permiso_existente: str(g.Permiso_existente),
    Dst_cmp: num(g.Dst_cmp),
    Cliente: str(g.Cliente),
    Cuit_pais_cliente: str(g.Cuit_pais_cliente),
    Domicilio_cliente: str(g.Domicilio_cliente),
    Id_impositivo: str(g.Id_impositivo),
    Moneda_Id: str(g.Moneda_Id),
    Moneda_ctz: num(g.Moneda_ctz),
    CanMisMonExt: str(g.CanMisMonExt),
    Imp_total: num(g.Imp_total),
    Forma_pago: str(g.Forma_pago),
    Incoterms: str(g.Incoterms),
    Incoterms_Ds: str(g.Incoterms_Ds),
    Idioma_cbte: num(g.Idioma_cbte),
    Items: parseItems(g.Items),
    Opcionales: ensureArray(dig(g.Opcionales, ['Opcional']))
      .filter(esObjeto)
      .map((o) => ({ Id: str(o.Id), Valor: str(o.Valor) })),
    Fecha_cbte_cae: str(g.Fecha_cbte_cae),
    Fch_venc_Cae: str(g.Fch_venc_Cae),
    Cae: str(g.Cae),
    Resultado: str(g.Resultado).toUpperCase(),
    Motivos_Obs: str(g.Motivos_Obs),
    raw: result,
  }
}

export function parseFexGetCmpResponse(xml: string, httpStatus?: number): FexCmpConsultado | null {
  return parseFexGetCmpResult(parseFexSoapResponse('FEXGetCMP', xml, httpStatus))
}

/** null si ARCA no tiene cotización para esa fecha (FEXErr 1800 o Mon_ctz vacío/0). */
export function parseFexCtzResult(result: Record<string, unknown>): FexCotizacionResult | null {
  const { errores } = parseFexErrores(result)
  if (errores.some((e) => e.Code === FEX_ERR.SIN_COTIZACION)) return null
  if (errores.length) {
    throw new ArcaError(`FEXGetPARAM_Ctz: ${formatFexErrores(errores)}`, errores, [], result)
  }
  const g = esObjeto(result.FEXResultGet) ? result.FEXResultGet : {}
  const monCtz = num(g.Mon_ctz)
  if (!(monCtz > 0)) return null
  return { monCtz, monFecha: str(g.Mon_fecha) }
}

/** Lista de una tabla FEXGetPARAM_* (el primer hijo de FEXResultGet, como array). */
export function parseFexParamLista(result: Record<string, unknown>): Record<string, unknown>[] {
  const g = result.FEXResultGet
  if (!esObjeto(g)) return []
  const first = Object.keys(g)[0]
  return first ? ensureArray(g[first]).filter(esObjeto) : []
}

// ---------------------------------------------------------------------------
// Fechas en hora argentina (el servidor puede estar en UTC)
// ---------------------------------------------------------------------------

const TZ_AR = 'America/Argentina/Buenos_Aires'
const fmtFechaAR = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ_AR,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Fecha calendario en Argentina como YYYY-MM-DD (a las 22:30 AR sigue siendo "hoy"). */
export function fechaIsoAR(d: Date): string {
  const parts = fmtFechaAR.formatToParts(d)
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Fecha calendario en Argentina como yyyymmdd (Fecha_cbte). */
export function fechaYmdAR(d: Date): string {
  return fechaIsoAR(d).replace(/-/g, '')
}

/** Resta días a una fecha YYYY-MM-DD (aritmética de calendario, sin zona horaria). */
export function restarDiasIso(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - dias)).toISOString().slice(0, 10)
}

/**
 * yyyymmdd → Date a las 12:00 de Argentina (15:00 UTC): el día calendario es
 * el mismo leído en UTC o en hora AR (buildQrUrl usa toISOString).
 */
export function fechaDesdeYmd(s: string): Date {
  if (!/^\d{8}$/.test(s)) return new Date(NaN)
  return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)), 15))
}

// ---------------------------------------------------------------------------
// Transporte SOAP
// ---------------------------------------------------------------------------

type AuthModo = 'ninguna' | 'comun' | { Pto_venta: number; Cbte_Tipo: number }

async function call(
  method: string,
  innerXml: string,
  auth: AuthModo = 'comun',
  timeoutMs = 60000
): Promise<Record<string, unknown>> {
  const cfg = getArcaConfig()
  let authXml = ''
  if (auth !== 'ninguna') {
    const ta = await getTicketAcceso('wsfex')
    authXml = buildFexAuthXml({
      token: ta.token,
      sign: ta.sign,
      cuit: cfg.cuit,
      ...(typeof auth === 'object' ? auth : {}),
    })
  }
  const res = await postSoap(
    cfg.wsfexUrl,
    buildFexEnvelope(method, authXml + innerXml),
    { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `${FEX_NS}${method}` },
    timeoutMs
  )
  return parseFexSoapResponse(method, res.text, res.status)
}

function lanzarSiHayErrores(method: string, r: Record<string, unknown>): void {
  const { errores } = parseFexErrores(r)
  if (errores.length) throw new ArcaError(`${method}: ${formatFexErrores(errores)}`, errores, [], r)
}

// ---------------------------------------------------------------------------
// Métodos
// ---------------------------------------------------------------------------

/** Verifica conectividad (no requiere TA). */
export async function fexDummy(): Promise<{ AppServer: string; DbServer: string; AuthServer: string }> {
  const r = await call('FEXDummy', '', 'ninguna')
  return { AppServer: str(r.AppServer), DbServer: str(r.DbServer), AuthServer: str(r.AuthServer) }
}

/** Último número autorizado para tipo + PV (0 si nunca se emitió). */
export async function fexGetLastCmp(cbteTipo: number, ptoVta: number): Promise<number> {
  const r = await call('FEXGetLast_CMP', '', { Pto_venta: ptoVta, Cbte_Tipo: cbteTipo })
  lanzarSiHayErrores('FEXGetLast_CMP', r)
  return num(dig(r, ['FEXResult_LastCMP', 'Cbte_nro']))
}

/** Último Cmp.Id usado por el CUIT (0 si nunca se usó). */
export async function fexGetLastId(): Promise<number> {
  const r = await call('FEXGetLast_ID', '')
  lanzarSiHayErrores('FEXGetLast_ID', r)
  return num(dig(r, ['FEXResultGet', 'Id']))
}

/**
 * Pide CAE para un Cmp. Recibe el Cmp o su XML ya armado (para reenviar
 * EXACTAMENTE el mismo cuerpo ante un corte). No lanza ante un rechazo ('R'
 * o FEXErr): el llamador decide. Lanza FexFaultError ante SOAP Fault y
 * ArcaError/Error ante errores de transporte o respuestas sin resultado.
 */
export async function fexAuthorize(cmp: FexCmp | string, timeoutMs = 60000): Promise<FexAuthorizeResult> {
  const body = typeof cmp === 'string' ? cmp : buildFexAuthorizeBody(cmp)
  const r = await call('FEXAuthorize', body, 'comun', timeoutMs)
  return parseFexAuthorizeResult(r)
}

/** Consulta un comprobante emitido. null si ARCA dice que no existe. */
export async function fexGetCmp(cbteTipo: number, ptoVta: number, cbteNro: number): Promise<FexCmpConsultado | null> {
  const r = await call(
    'FEXGetCMP',
    `<ar:Cmp>${tag('Cbte_tipo', cbteTipo)}${tag('Punto_vta', ptoVta)}${tag('Cbte_nro', cbteNro)}</ar:Cmp>`
  )
  return parseFexGetCmpResult(r)
}

/**
 * Cotización oficial de ARCA para una moneda en una fecha (YYYY-MM-DD, a
 * diferencia del resto de WSFEX). null si no hay cotización para esa fecha.
 */
export async function fexGetParamCtz(monId: string, fchCotiz: string): Promise<FexCotizacionResult | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fchCotiz)) {
    throw new Error(`FEXGetPARAM_Ctz: la fecha va como YYYY-MM-DD (recibido "${fchCotiz}")`)
  }
  const r = await call('FEXGetPARAM_Ctz', tag('Mon_id', monId) + tag('FchCotiz', fchCotiz))
  return parseFexCtzResult(r)
}

/**
 * Busca la cotización empezando en `desdeIso` (YYYY-MM-DD) y yendo hacia
 * atrás día por día hasta `maxDias` fechas (fines de semana, feriados o la
 * del día todavía no publicada). `antesDeIso`: descarta cotizaciones con
 * fecha igual o posterior (la del día del comprobante). Si ninguna sirve,
 * lanza: NUNCA se inventa un tipo de cambio.
 */
export async function buscarCotizacionHaciaAtras(
  consultar: (fechaIso: string) => Promise<FexCotizacionResult | null>,
  desdeIso: string,
  maxDias = 7,
  monId = 'DOL',
  opts: { antesDeIso?: string } = {}
): Promise<CotizacionFex> {
  const limite = opts.antesDeIso?.replace(/-/g, '')
  for (let i = 0; i < maxDias; i++) {
    const fecha = restarDiasIso(desdeIso, i)
    const r = await consultar(fecha)
    if (r && r.monCtz > 0) {
      const fechaCotizacion = r.monFecha || fecha.replace(/-/g, '')
      if (limite && fechaCotizacion.replace(/-/g, '') >= limite) continue
      return { monId, cotizacion: r.monCtz, fechaConsultada: fecha, fechaCotizacion, diasAtras: i }
    }
  }
  throw new ArcaError(
    `ARCA no informa cotización ${monId} entre ${restarDiasIso(desdeIso, Math.max(maxDias - 1, 0))} y ${desdeIso}; no se puede emitir sin el tipo de cambio oficial`
  )
}

/**
 * Cotización oficial de ARCA (default DOL) para un comprobante de la fecha
 * `fechaCbte` (default hoy en hora AR): la del día hábil ANTERIOR (RG 5616),
 * buscando desde ayer hacia atrás y nunca la del mismo día del comprobante.
 */
export function fexGetCotizacion(
  monId = 'DOL',
  opts: { fechaCbte?: Date; maxDias?: number } = {}
): Promise<CotizacionFex> {
  const hoy = fechaIsoAR(opts.fechaCbte ?? new Date())
  return buscarCotizacionHaciaAtras(
    (fecha) => fexGetParamCtz(monId, fecha),
    restarDiasIso(hoy, 1),
    opts.maxDias ?? 7,
    monId,
    { antesDeIso: hoy }
  )
}

export type FexParamTabla =
  | 'Cbte_Tipo'
  | 'Tipo_Expo'
  | 'Incoterms'
  | 'Idiomas'
  | 'UMed'
  | 'DST_pais'
  | 'DST_CUIT'
  | 'MON'
  | 'MON_CON_COTIZACION'
  | 'Opcionales'
  | 'PtoVenta'
  | 'Actividades'

/**
 * Tabla de parámetros FEXGetPARAM_<tabla> como lista de objetos planos.
 * `params` agrega elementos después de Auth (ej. { Fecha_CTZ: '20261001' } para MON_CON_COTIZACION).
 */
export async function fexGetParam(
  tabla: FexParamTabla,
  params: Record<string, string | number> = {}
): Promise<Record<string, unknown>[]> {
  const method = `FEXGetPARAM_${tabla}`
  const r = await call(method, Object.entries(params).map(([k, v]) => tag(k, v)).join(''))
  lanzarSiHayErrores(method, r)
  return parseFexParamLista(r)
}

/** Verifica un permiso de embarque contra el país de destino de la mercadería (despachante, fase 3). */
export async function fexCheckPermiso(idPermiso: string, dstMerc: number): Promise<string> {
  const r = await call('FEXCheck_Permiso', tag('ID_Permiso', idPermiso) + tag('Dst_merc', dstMerc))
  lanzarSiHayErrores('FEXCheck_Permiso', r)
  return str(dig(r, ['FEXResultGet', 'Status']))
}

/**
 * WSFEv1 — Web Service de Facturación Electrónica de ARCA (comprobantes
 * A/B/C/E, NC/ND, FCE MiPyME). Cliente SOAP mínimo sin dependencias pesadas:
 * arma el XML a mano y parsea la respuesta con fast-xml-parser.
 *
 * Manual oficial: "Manual para el desarrollador WSFEv1" (RG 4291 y ss.).
 *
 * Uso típico:
 *   const ultimo = await feCompUltimoAutorizado(1)           // último FA del PV
 *   const r = await feCAESolicitar({ ... CbteDesde: ultimo + 1 ... })
 */
import { XMLParser } from 'fast-xml-parser'
import { getArcaConfig } from './config'
import { getTicketAcceso } from './wsaa'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Tablas de referencia (subset que usa el ERP)
// ---------------------------------------------------------------------------

/** Tipos de comprobante (FEParamGetTiposCbte) */
export const CBTE_TIPO = {
  FACTURA_A: 1,
  NOTA_DEBITO_A: 2,
  NOTA_CREDITO_A: 3,
  FACTURA_B: 6,
  NOTA_DEBITO_B: 7,
  NOTA_CREDITO_B: 8,
  FACTURA_C: 11,
  NOTA_DEBITO_C: 12,
  NOTA_CREDITO_C: 13,
  FACTURA_E: 19,
  NOTA_DEBITO_E: 20,
  NOTA_CREDITO_E: 21,
  FCE_A: 201,
  FCE_NOTA_DEBITO_A: 202,
  FCE_NOTA_CREDITO_A: 203,
  FCE_B: 206,
  FCE_NOTA_DEBITO_B: 207,
  FCE_NOTA_CREDITO_B: 208,
} as const
export type CbteTipo = (typeof CBTE_TIPO)[keyof typeof CBTE_TIPO]

/** Tipos de documento del receptor (FEParamGetTiposDoc) */
export const DOC_TIPO = {
  CUIT: 80,
  CUIL: 86,
  DNI: 96,
  CONSUMIDOR_FINAL: 99,
} as const

/** Alícuotas de IVA (FEParamGetTiposIva) */
export const IVA_ID = {
  '0': 3,
  '10.5': 4,
  '21': 5,
  '27': 6,
  '5': 8,
  '2.5': 9,
} as const

/** Concepto del comprobante */
export const CONCEPTO = { PRODUCTOS: 1, SERVICIOS: 2, PRODUCTOS_Y_SERVICIOS: 3 } as const

/**
 * Condición frente al IVA del receptor (FEParamGetCondicionIvaReceptor),
 * obligatoria desde RG 5616/2024.
 */
export const CONDICION_IVA_RECEPTOR = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTO: 6,
  NO_CATEGORIZADO: 7,
  PROVEEDOR_EXTERIOR: 8,
  CLIENTE_EXTERIOR: 9,
  LIBERADO_LEY_19640: 10,
  MONOTRIBUTO_SOCIAL: 13,
  MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE: 16,
} as const

export const MONEDA = { PESOS: 'PES', DOLAR: 'DOL' } as const

// ---------------------------------------------------------------------------
// Tipos de request / response
// ---------------------------------------------------------------------------

export interface AlicuotaIva {
  Id: number // IVA_ID
  BaseImp: number
  Importe: number
}

export interface Tributo {
  Id: number // 1 Nac, 2 Prov, 3 Mun, 4 Imp internos, 99 Otros
  Desc?: string
  BaseImp: number
  Alic: number
  Importe: number
}

export interface CbteAsociado {
  Tipo: number
  PtoVta: number
  Nro: number
  Cuit?: string
  CbteFch?: string // yyyymmdd
}

export interface Opcional {
  Id: string
  Valor: string
}

export interface FECAEDetRequest {
  Concepto: number
  DocTipo: number
  DocNro: string | number
  CbteDesde: number
  CbteHasta: number
  CbteFch: string // yyyymmdd
  ImpTotal: number
  ImpTotConc: number // neto no gravado
  ImpNeto: number // neto gravado
  ImpOpEx: number // exento
  ImpTrib: number
  ImpIVA: number
  FchServDesde?: string
  FchServHasta?: string
  FchVtoPago?: string
  MonId: string // 'PES' | 'DOL'
  MonCotiz: number
  CanMisMonExt?: 'S' | 'N' // cancelación en misma moneda extranjera (RG 5616)
  CondicionIVAReceptorId: number
  CbtesAsoc?: CbteAsociado[]
  Tributos?: Tributo[]
  Iva?: AlicuotaIva[]
  Opcionales?: Opcional[]
  PeriodoAsoc?: { FchDesde: string; FchHasta: string }
}

export interface FECAESolicitarParams {
  PtoVta?: number // default: config
  CbteTipo: number
  detalle: FECAEDetRequest
}

export interface ArcaObservacion {
  Code: number
  Msg: string
}

export interface FECAEResult {
  Resultado: 'A' | 'R' | 'P'
  CbteDesde: number
  CbteHasta: number
  CbteFch: string
  CAE: string
  CAEFchVto: string // yyyymmdd
  Observaciones: ArcaObservacion[]
  Errors: ArcaObservacion[]
  Events: ArcaObservacion[]
  raw: unknown
}

export interface FECompConsultarResult {
  CbteDesde: number
  CbteHasta: number
  CbteFch: string
  CodAutorizacion: string
  FchVto: string
  Resultado: string
  ImpTotal: number
  MonId: string
  MonCotiz: number
  DocTipo: number
  DocNro: string
  raw: unknown
}

export class ArcaError extends Error {
  constructor(
    message: string,
    public readonly errors: ArcaObservacion[] = [],
    public readonly observaciones: ArcaObservacion[] = [],
    public readonly raw?: unknown
  ) {
    super(message)
    this.name = 'ArcaError'
  }
}

// ---------------------------------------------------------------------------
// Helpers de XML
// ---------------------------------------------------------------------------

const NS = 'http://ar.gov.afip.dif.FEV1/'

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

/** Serializa un objeto plano a tags en el orden de sus claves. */
function obj(name: string, o: Record<string, unknown> | undefined): string {
  if (!o) return ''
  const inner = Object.entries(o)
    .map(([k, v]) => {
      if (v === undefined || v === null) return ''
      if (Array.isArray(v)) return arr(k, v as Record<string, unknown>[])
      if (typeof v === 'object') return obj(k, v as Record<string, unknown>)
      return tag(k, v)
    })
    .join('')
  return `<ar:${name}>${inner}</ar:${name}>`
}

function arr(name: string, items: Record<string, unknown>[] | undefined): string {
  if (!items || items.length === 0) return ''
  // Nombre del elemento hijo según el manual (CbtesAsoc → CbteAsoc, Iva → AlicIva, etc.)
  const childName: Record<string, string> = {
    CbtesAsoc: 'CbteAsoc',
    Tributos: 'Tributo',
    Iva: 'AlicIva',
    Opcionales: 'Opcional',
    Compradores: 'Comprador',
    Actividades: 'Actividad',
    FeDetReq: 'FECAEDetRequest',
  }
  const child = childName[name] ?? name.replace(/s$/, '')
  return `<ar:${name}>${items.map((it) => obj(child, it)).join('')}</ar:${name}>`
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

function parseObs(list: unknown, key: 'Obs' | 'Err' | 'Evt'): ArcaObservacion[] {
  const items = ensureArray(dig(list, [key])) as Record<string, unknown>[]
  return items.map((i) => ({ Code: Number(i.Code), Msg: String(i.Msg ?? '') }))
}

// ---------------------------------------------------------------------------
// Transporte SOAP
// ---------------------------------------------------------------------------

async function authXml(): Promise<string> {
  const ta = await getTicketAcceso('wsfe')
  const { cuit } = getArcaConfig()
  return `<ar:Auth>${tag('Token', ta.token)}${tag('Sign', ta.sign)}${tag('Cuit', cuit)}</ar:Auth>`
}

/**
 * Llama a un método de WSFEv1 y devuelve el contenido de `<MethodResult>`
 * ya parseado. Lanza ArcaError si ARCA devuelve Errors a nivel raíz.
 */
async function call(method: string, bodyXml: string, withAuth = true): Promise<Record<string, unknown>> {
  const cfg = getArcaConfig()
  const auth = withAuth ? await authXml() : ''
  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}">` +
    `<soapenv:Header/><soapenv:Body><ar:${method}>${auth}${bodyXml}</ar:${method}></soapenv:Body></soapenv:Envelope>`

  const res = await fetch(cfg.wsfeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `${NS}${method}` },
    body: envelope,
    signal: AbortSignal.timeout(60000),
  })
  const text = await res.text()
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false })
  const doc = parser.parse(text) as Record<string, unknown>

  const fault = dig(doc, ['Envelope', 'Body', 'Fault']) as Record<string, unknown> | undefined
  if (fault) {
    throw new ArcaError(`WSFE ${method} fault: ${String(fault.faultstring ?? fault.faultcode ?? '')}`, [], [], text)
  }
  const result = dig(doc, ['Envelope', 'Body', `${method}Response`, `${method}Result`]) as
    | Record<string, unknown>
    | undefined
  if (!result) {
    throw new ArcaError(`WSFE ${method}: respuesta inesperada (HTTP ${res.status})`, [], [], text.slice(0, 500))
  }
  return result
}

// ---------------------------------------------------------------------------
// Métodos
// ---------------------------------------------------------------------------

/** Verifica conectividad (no requiere TA). */
export async function feDummy(): Promise<{ AppServer: string; DbServer: string; AuthServer: string }> {
  const r = await call('FEDummy', '', false)
  return {
    AppServer: String(r.AppServer),
    DbServer: String(r.DbServer),
    AuthServer: String(r.AuthServer),
  }
}

/** Último número de comprobante autorizado para el PV y tipo. 0 si nunca se emitió. */
export async function feCompUltimoAutorizado(cbteTipo: number, ptoVta?: number): Promise<number> {
  const pv = ptoVta ?? getArcaConfig().puntoVenta
  const r = await call('FECompUltimoAutorizado', tag('PtoVta', pv) + tag('CbteTipo', cbteTipo))
  const errors = parseObs(r.Errors, 'Err')
  if (errors.length) {
    throw new ArcaError(`FECompUltimoAutorizado: ${errors.map((e) => `${e.Code} ${e.Msg}`).join('; ')}`, errors, [], r)
  }
  return Number(r.CbteNro ?? 0)
}

/**
 * Solicita CAE para UN comprobante. Devuelve el resultado aunque ARCA lo
 * rechace (Resultado 'R'); el llamador decide. Lanza ArcaError solo ante
 * errores de transporte/estructurales (Errors a nivel raíz sin detalle).
 */
export async function feCAESolicitar(params: FECAESolicitarParams): Promise<FECAEResult> {
  const pv = params.PtoVta ?? getArcaConfig().puntoVenta
  const d = params.detalle

  // Orden de campos según el XSD de WSFEv1 (importa para el parser de ARCA)
  const det: Record<string, unknown> = {
    Concepto: d.Concepto,
    DocTipo: d.DocTipo,
    DocNro: d.DocNro,
    CbteDesde: d.CbteDesde,
    CbteHasta: d.CbteHasta,
    CbteFch: d.CbteFch,
    ImpTotal: fix2(d.ImpTotal),
    ImpTotConc: fix2(d.ImpTotConc),
    ImpNeto: fix2(d.ImpNeto),
    ImpOpEx: fix2(d.ImpOpEx),
    ImpTrib: fix2(d.ImpTrib),
    ImpIVA: fix2(d.ImpIVA),
    FchServDesde: d.FchServDesde,
    FchServHasta: d.FchServHasta,
    FchVtoPago: d.FchVtoPago,
    MonId: d.MonId,
    MonCotiz: d.MonCotiz,
    CanMisMonExt: d.CanMisMonExt,
    CondicionIVAReceptorId: d.CondicionIVAReceptorId,
    CbtesAsoc: d.CbtesAsoc?.map((c) => ({ ...c })),
    Tributos: d.Tributos?.map((t) => ({ ...t, BaseImp: fix2(t.BaseImp), Importe: fix2(t.Importe) })),
    Iva: d.Iva?.map((i) => ({ Id: i.Id, BaseImp: fix2(i.BaseImp), Importe: fix2(i.Importe) })),
    Opcionales: d.Opcionales?.map((o) => ({ ...o })),
    PeriodoAsoc: d.PeriodoAsoc,
  }

  const body =
    `<ar:FeCAEReq>` +
    obj('FeCabReq', { CantReg: 1, PtoVta: pv, CbteTipo: params.CbteTipo }) +
    `<ar:FeDetReq>` +
    obj('FECAEDetRequest', det) +
    `</ar:FeDetReq>` +
    `</ar:FeCAEReq>`

  const r = await call('FECAESolicitar', body)
  const rootErrors = parseObs(r.Errors, 'Err')
  const events = parseObs(r.Events, 'Evt')
  const cab = (r.FeCabResp ?? {}) as Record<string, unknown>
  const detResp = ensureArray(dig(r, ['FeDetResp', 'FECAEDetResponse']))[0] as Record<string, unknown> | undefined

  if (!detResp) {
    throw new ArcaError(
      `FECAESolicitar sin detalle de respuesta: ${rootErrors.map((e) => `${e.Code} ${e.Msg}`).join('; ') || 'sin errores informados'}`,
      rootErrors,
      [],
      r
    )
  }

  const observaciones = parseObs(detResp.Observaciones, 'Obs')
  const result: FECAEResult = {
    Resultado: String(cab.Resultado ?? detResp.Resultado ?? 'R') as 'A' | 'R' | 'P',
    CbteDesde: Number(detResp.CbteDesde),
    CbteHasta: Number(detResp.CbteHasta),
    CbteFch: String(detResp.CbteFch ?? ''),
    CAE: String(detResp.CAE ?? ''),
    CAEFchVto: String(detResp.CAEFchVto ?? ''),
    Observaciones: observaciones,
    Errors: rootErrors,
    Events: events,
    raw: r,
  }
  if (result.Resultado !== 'A') {
    logger.warn('[WSFE] Comprobante rechazado', {
      pv,
      tipo: params.CbteTipo,
      nro: d.CbteDesde,
      errors: rootErrors,
      obs: observaciones,
    })
  }
  return result
}

/** Consulta un comprobante ya emitido (para verificar/reconciliar CAE). */
export async function feCompConsultar(
  cbteTipo: number,
  cbteNro: number,
  ptoVta?: number
): Promise<FECompConsultarResult | null> {
  const pv = ptoVta ?? getArcaConfig().puntoVenta
  const r = await call(
    'FECompConsultar',
    obj('FeCompConsReq', { CbteTipo: cbteTipo, CbteNro: cbteNro, PtoVta: pv })
  )
  const errors = parseObs(r.Errors, 'Err')
  // 602: "No existen datos en nuestros registros para los parametros ingresados"
  if (errors.some((e) => e.Code === 602)) return null
  if (errors.length) {
    throw new ArcaError(`FECompConsultar: ${errors.map((e) => `${e.Code} ${e.Msg}`).join('; ')}`, errors, [], r)
  }
  const g = (r.ResultGet ?? {}) as Record<string, unknown>
  return {
    CbteDesde: Number(g.CbteDesde),
    CbteHasta: Number(g.CbteHasta),
    CbteFch: String(g.CbteFch ?? ''),
    CodAutorizacion: String(g.CodAutorizacion ?? ''),
    FchVto: String(g.FchVto ?? ''),
    Resultado: String(g.Resultado ?? ''),
    ImpTotal: Number(g.ImpTotal ?? 0),
    MonId: String(g.MonId ?? ''),
    MonCotiz: Number(g.MonCotiz ?? 1),
    DocTipo: Number(g.DocTipo ?? 0),
    DocNro: String(g.DocNro ?? ''),
    raw: r,
  }
}

/** Cotización oficial de ARCA para una moneda (ej. 'DOL'). */
export async function feParamGetCotizacion(monId: string, fchCotiz?: string): Promise<{ MonId: string; MonCotiz: number; FchCotiz: string }> {
  const r = await call('FEParamGetCotizacion', tag('MonId', monId) + tag('FchCotiz', fchCotiz))
  const errors = parseObs(r.Errors, 'Err')
  if (errors.length) {
    throw new ArcaError(`FEParamGetCotizacion: ${errors.map((e) => `${e.Code} ${e.Msg}`).join('; ')}`, errors, [], r)
  }
  const g = (r.ResultGet ?? {}) as Record<string, unknown>
  return { MonId: String(g.MonId), MonCotiz: Number(g.MonCotiz), FchCotiz: String(g.FchCotiz) }
}

/** Tablas de parámetros (para diagnóstico / validar ids). */
export async function feParamGet(
  table:
    | 'TiposCbte'
    | 'TiposIva'
    | 'TiposDoc'
    | 'TiposMonedas'
    | 'TiposConcepto'
    | 'TiposTributos'
    | 'TiposOpcional'
    | 'PtosVenta'
    | 'CondicionIvaReceptor'
): Promise<Record<string, unknown>[]> {
  const r = await call(`FEParamGet${table}`, '')
  const errors = parseObs(r.Errors, 'Err')
  if (errors.length) {
    throw new ArcaError(`FEParamGet${table}: ${errors.map((e) => `${e.Code} ${e.Msg}`).join('; ')}`, errors, [], r)
  }
  const g = (r.ResultGet ?? {}) as Record<string, unknown>
  const firstKey = Object.keys(g)[0]
  return firstKey ? (ensureArray(g[firstKey]) as Record<string, unknown>[]) : []
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function fix2(n: number): string {
  return (Math.round(Number(n) * 100) / 100).toFixed(2)
}

/** Fecha Date → yyyymmdd (en hora local del servidor). */
export function toCbteFch(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/** yyyymmdd → Date (medianoche local). */
export function fromCbteFch(s: string): Date {
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)))
}

/** Número de comprobante formateado: 0007-00000123 */
export function formatNroComprobante(ptoVta: number, nro: number): string {
  return `${String(ptoVta).padStart(4, '0')}-${String(nro).padStart(8, '0')}`
}

/**
 * URL del código QR obligatorio en el comprobante (RG 4892/2020).
 * https://www.afip.gob.ar/fe/qr/?p=<base64(json)>
 */
export function buildQrUrl(p: {
  fecha: Date
  cuit: string
  ptoVta: number
  tipoCmp: number
  nroCmp: number
  importe: number
  moneda: string // 'PES' | 'DOL'
  ctz: number
  tipoDocRec?: number
  nroDocRec?: string | number
  codAut: string
}): string {
  const data: Record<string, unknown> = {
    ver: 1,
    fecha: p.fecha.toISOString().slice(0, 10),
    cuit: Number(p.cuit),
    ptoVta: p.ptoVta,
    tipoCmp: p.tipoCmp,
    nroCmp: p.nroCmp,
    importe: Math.round(p.importe * 100) / 100,
    moneda: p.moneda,
    ctz: p.ctz,
    tipoCodAut: 'E',
    codAut: Number(p.codAut),
  }
  if (p.tipoDocRec !== undefined && p.nroDocRec !== undefined) {
    data.tipoDocRec = p.tipoDocRec
    data.nroDocRec = Number(p.nroDocRec)
  }
  const b64 = Buffer.from(JSON.stringify(data), 'utf8').toString('base64')
  return `https://www.afip.gob.ar/fe/qr/?p=${b64}`
}

/**
 * Emisión de comprobantes electrónicos: capa por encima de WSFEv1 que
 * resuelve numeración, arma el FECAEDetRequest a partir de un comprobante
 * "de negocio" y maneja los casos borde de ARCA.
 *
 * Independiente del modelo de datos del ERP: recibe un ComprobanteInput ya
 * calculado (importes, IVA por alícuota, receptor) y devolve CAE + número.
 *
 * Casos borde cubiertos:
 *  - Numeración: siempre se consulta FECompUltimoAutorizado justo antes de
 *    emitir (ARCA es la fuente de verdad del último número; no se confía en
 *    un contador local). Un mutex en proceso evita dos emisiones simultáneas
 *    del mismo tipo de comprobante (pm2 corre una sola instancia).
 *  - Timeout / error de red DESPUÉS de que ARCA autorizó: se consulta
 *    FECompConsultar del número que íbamos a usar; si existe y coincide en
 *    importe/fecha/receptor, se toma ese CAE en vez de emitir de nuevo.
 *  - Resultado 'R': se devuelve un EmisionRechazada con las observaciones
 *    (código + mensaje de ARCA) para mostrarlas al usuario; no lanza.
 */
import {
  CBTE_TIPO,
  CONCEPTO,
  DOC_TIPO,
  IVA_ID,
  MONEDA,
  ArcaError,
  feCAESolicitar,
  feCompConsultar,
  feCompUltimoAutorizado,
  formatNroComprobante,
  toCbteFch,
  type AlicuotaIva,
  type CbteAsociado,
  type FECAEDetRequest,
  type Tributo,
} from './wsfe'
import { getArcaConfig } from './config'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Tipos de entrada / salida
// ---------------------------------------------------------------------------

export type LetraComprobante = 'A' | 'B' | 'C'
export type ClaseComprobante = 'FACTURA' | 'NOTA_CREDITO' | 'NOTA_DEBITO'

export interface ReceptorInput {
  /** 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO' | 'CONSUMIDOR_FINAL' | ... */
  condicionIvaId: number // CONDICION_IVA_RECEPTOR.*
  docTipo: number // DOC_TIPO.*
  docNro: string // CUIT/DNI sin guiones; '0' para consumidor final sin identificar
}

export interface IvaInput {
  /** Alícuota como string: '21' | '10.5' | '27' | '0' | '5' | '2.5' */
  alicuota: keyof typeof IVA_ID
  baseImponible: number
  importe: number
}

export interface ComprobanteInput {
  clase: ClaseComprobante
  letra: LetraComprobante
  /** Default: PV de la config */
  puntoVenta?: number
  fecha: Date
  concepto?: number // CONCEPTO.* (default PRODUCTOS)
  receptor: ReceptorInput
  moneda: 'ARS' | 'USD'
  /** Obligatorio si moneda = USD (cotización ARS por USD, la del comprobante) */
  cotizacion?: number
  /**
   * Solo USD: 'S' si la operación se cancela en la misma moneda extranjera,
   * 'N' si se cancela en pesos (RG 5616). Default 'N'.
   */
  cancelaEnMonedaExtranjera?: boolean
  importes: {
    netoGravado: number
    netoNoGravado: number
    exento: number
    iva: IvaInput[]
    tributos?: Tributo[]
    total: number
  }
  /** Comprobantes asociados (obligatorio para NC/ND) */
  asociados?: CbteAsociado[]
  /** Para concepto servicios: período y vencimiento (yyyymmdd) */
  servicios?: { desde: string; hasta: string; vtoPago: string }
}

export interface EmisionAutorizada {
  ok: true
  cbteTipo: number
  puntoVenta: number
  numero: number
  numeroFormateado: string // 0007-00000001
  cae: string
  caeVencimiento: Date
  fecha: Date
  observaciones: Array<{ Code: number; Msg: string }>
  /** true si el CAE se recuperó de ARCA tras un corte (no se emitió dos veces) */
  recuperado?: boolean
}

export interface EmisionRechazada {
  ok: false
  cbteTipo: number
  puntoVenta: number
  numero: number
  errores: Array<{ Code: number; Msg: string }>
  mensaje: string
}

export type EmisionResult = EmisionAutorizada | EmisionRechazada

// ---------------------------------------------------------------------------
// Mapeo clase+letra → CbteTipo
// ---------------------------------------------------------------------------

const CBTE_MAP: Record<LetraComprobante, Record<ClaseComprobante, number>> = {
  A: { FACTURA: CBTE_TIPO.FACTURA_A, NOTA_CREDITO: CBTE_TIPO.NOTA_CREDITO_A, NOTA_DEBITO: CBTE_TIPO.NOTA_DEBITO_A },
  B: { FACTURA: CBTE_TIPO.FACTURA_B, NOTA_CREDITO: CBTE_TIPO.NOTA_CREDITO_B, NOTA_DEBITO: CBTE_TIPO.NOTA_DEBITO_B },
  C: { FACTURA: CBTE_TIPO.FACTURA_C, NOTA_CREDITO: CBTE_TIPO.NOTA_CREDITO_C, NOTA_DEBITO: CBTE_TIPO.NOTA_DEBITO_C },
}

export function cbteTipoFor(letra: LetraComprobante, clase: ClaseComprobante): number {
  return CBTE_MAP[letra][clase]
}

export function describeCbteTipo(cbteTipo: number): string {
  const names: Record<number, string> = {
    1: 'Factura A',
    2: 'Nota de Débito A',
    3: 'Nota de Crédito A',
    6: 'Factura B',
    7: 'Nota de Débito B',
    8: 'Nota de Crédito B',
    11: 'Factura C',
    12: 'Nota de Débito C',
    13: 'Nota de Crédito C',
    201: 'FCE A',
    202: 'Nota de Débito FCE A',
    203: 'Nota de Crédito FCE A',
  }
  return names[cbteTipo] ?? `Comprobante ${cbteTipo}`
}

// ---------------------------------------------------------------------------
// Mutex por (PV, tipo) para no pisar numeración dentro del proceso
// ---------------------------------------------------------------------------

const locks = new Map<string, Promise<unknown>>()

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((r) => (release = r))
  locks.set(
    key,
    prev.then(() => current)
  )
  try {
    await prev
    return await fn()
  } finally {
    release()
    if (locks.get(key) === current) locks.delete(key)
  }
}

// ---------------------------------------------------------------------------
// Armado del detalle
// ---------------------------------------------------------------------------

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

export function buildDetalle(input: ComprobanteInput, numero: number): FECAEDetRequest {
  const { importes } = input
  const esUsd = input.moneda === 'USD'
  if (esUsd && !(input.cotizacion && input.cotizacion > 0)) {
    throw new Error('Comprobante en USD sin cotización')
  }

  const iva: AlicuotaIva[] = importes.iva
    .filter((i) => i.baseImponible !== 0 || i.importe !== 0)
    .map((i) => ({ Id: IVA_ID[i.alicuota], BaseImp: r2(i.baseImponible), Importe: r2(i.importe) }))

  const impIVA = r2(iva.reduce((s, i) => s + i.Importe, 0))
  const impTrib = r2((importes.tributos ?? []).reduce((s, t) => s + t.Importe, 0))
  const impNeto = r2(importes.netoGravado)
  const impTotConc = r2(importes.netoNoGravado)
  const impOpEx = r2(importes.exento)
  const impTotal = r2(importes.total)

  // Validación de consistencia (ARCA rechaza con 10048/10049 si no cierra)
  const calc = r2(impNeto + impTotConc + impOpEx + impIVA + impTrib)
  if (Math.abs(calc - impTotal) > 0.02) {
    throw new Error(
      `Importes inconsistentes: neto ${impNeto} + no gravado ${impTotConc} + exento ${impOpEx} + IVA ${impIVA} + tributos ${impTrib} = ${calc} ≠ total ${impTotal}`
    )
  }

  // Factura B/C al consumidor final: si no hay IVA discriminado igual se
  // informa la alícuota (ARCA exige Iva[] cuando ImpNeto > 0, salvo letra C).
  const letraC = input.letra === 'C'

  const det: FECAEDetRequest = {
    Concepto: input.concepto ?? CONCEPTO.PRODUCTOS,
    DocTipo: input.receptor.docTipo,
    DocNro: input.receptor.docNro || '0',
    CbteDesde: numero,
    CbteHasta: numero,
    CbteFch: toCbteFch(input.fecha),
    ImpTotal: impTotal,
    ImpTotConc: impTotConc,
    ImpNeto: impNeto,
    ImpOpEx: impOpEx,
    ImpTrib: impTrib,
    ImpIVA: letraC ? 0 : impIVA,
    MonId: esUsd ? MONEDA.DOLAR : MONEDA.PESOS,
    MonCotiz: esUsd ? Number(input.cotizacion) : 1,
    CondicionIVAReceptorId: input.receptor.condicionIvaId,
    CbtesAsoc: input.asociados?.length ? input.asociados : undefined,
    Tributos: importes.tributos?.length ? importes.tributos : undefined,
    Iva: letraC ? undefined : iva.length ? iva : undefined,
  }
  if (esUsd) det.CanMisMonExt = input.cancelaEnMonedaExtranjera ? 'S' : 'N'
  if (det.Concepto !== CONCEPTO.PRODUCTOS && input.servicios) {
    det.FchServDesde = input.servicios.desde
    det.FchServHasta = input.servicios.hasta
    det.FchVtoPago = input.servicios.vtoPago
  }
  if (input.clase !== 'FACTURA' && !input.asociados?.length) {
    throw new Error('Una nota de crédito/débito requiere al menos un comprobante asociado')
  }
  return det
}

// ---------------------------------------------------------------------------
// Emisión
// ---------------------------------------------------------------------------

/**
 * Emite un comprobante y devuelve CAE + número, o el rechazo de ARCA.
 * Lanza solo ante errores de configuración/transporte no recuperables.
 */
export async function emitirComprobante(input: ComprobanteInput): Promise<EmisionResult> {
  const cfg = getArcaConfig()
  const pv = input.puntoVenta ?? cfg.puntoVenta
  const cbteTipo = cbteTipoFor(input.letra, input.clase)

  return withLock(`${pv}:${cbteTipo}`, async () => {
    const ultimo = await feCompUltimoAutorizado(cbteTipo, pv)
    const numero = ultimo + 1
    const detalle = buildDetalle(input, numero)

    logger.info(`[ARCA] Emitiendo ${describeCbteTipo(cbteTipo)} ${formatNroComprobante(pv, numero)} total=${detalle.ImpTotal} ${detalle.MonId}`)

    try {
      const r = await feCAESolicitar({ PtoVta: pv, CbteTipo: cbteTipo, detalle })

      if (r.Resultado === 'A' && r.CAE) {
        return {
          ok: true,
          cbteTipo,
          puntoVenta: pv,
          numero: r.CbteDesde || numero,
          numeroFormateado: formatNroComprobante(pv, r.CbteDesde || numero),
          cae: r.CAE,
          caeVencimiento: parseYmd(r.CAEFchVto),
          fecha: input.fecha,
          observaciones: r.Observaciones,
        }
      }

      const errores = [...r.Errors, ...r.Observaciones]
      return {
        ok: false,
        cbteTipo,
        puntoVenta: pv,
        numero,
        errores,
        mensaje: errores.map((e) => `[${e.Code}] ${e.Msg}`).join(' · ') || `ARCA devolvió Resultado=${r.Resultado} sin detalle`,
      }
    } catch (err) {
      // Posible "autorizado pero no nos llegó la respuesta": consultar el número
      const recovered = await tryRecover(cbteTipo, numero, pv, detalle)
      if (recovered) {
        logger.warn(`[ARCA] CAE recuperado tras error de red para ${formatNroComprobante(pv, numero)}`)
        return { ...recovered, fecha: input.fecha, recuperado: true }
      }
      if (err instanceof ArcaError) {
        return {
          ok: false,
          cbteTipo,
          puntoVenta: pv,
          numero,
          errores: err.errors,
          mensaje: err.message,
        }
      }
      throw err
    }
  })
}

async function tryRecover(
  cbteTipo: number,
  numero: number,
  pv: number,
  detalle: FECAEDetRequest
): Promise<EmisionAutorizada | null> {
  try {
    const c = await feCompConsultar(cbteTipo, numero, pv)
    if (!c || c.Resultado !== 'A' || !c.CodAutorizacion) return null
    // Verificar que es "nuestro" comprobante y no uno emitido por otro lado
    const mismoTotal = Math.abs(c.ImpTotal - Number(detalle.ImpTotal)) < 0.02
    const mismaFecha = c.CbteFch === detalle.CbteFch
    const mismoDoc = String(c.DocNro) === String(detalle.DocNro)
    if (!mismoTotal || !mismaFecha || !mismoDoc) {
      logger.error('[ARCA] El comprobante consultado no coincide con el emitido; NO se recupera', {
        esperado: { total: detalle.ImpTotal, fecha: detalle.CbteFch, doc: detalle.DocNro },
        arca: { total: c.ImpTotal, fecha: c.CbteFch, doc: c.DocNro },
      })
      return null
    }
    return {
      ok: true,
      cbteTipo,
      puntoVenta: pv,
      numero,
      numeroFormateado: formatNroComprobante(pv, numero),
      cae: c.CodAutorizacion,
      caeVencimiento: parseYmd(c.FchVto),
      fecha: parseYmd(c.CbteFch),
      observaciones: [],
    }
  } catch (e) {
    logger.warn('[ARCA] No se pudo consultar el comprobante para recuperar CAE:', (e as Error).message)
    return null
  }
}

function parseYmd(s: string): Date {
  if (!s || s.length < 8) return new Date(NaN)
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)))
}

// ---------------------------------------------------------------------------
// Helpers para mapear datos del ERP
// ---------------------------------------------------------------------------

/**
 * Determina letra y condición IVA del receptor a partir de la condición
 * fiscal del cliente (texto libre como viene de Colppy / del ERP).
 * El emisor es Responsable Inscripto.
 */
export function receptorDesdeCondicion(condicion: string | null | undefined, cuit: string | null | undefined): {
  letra: LetraComprobante
  receptor: ReceptorInput
} {
  const c = (condicion ?? '').toLowerCase().replace(/_/g, ' ')
  const doc = (cuit ?? '').replace(/\D/g, '')
  const tieneCuit = doc.length === 11

  // Enums legacy del ERP (RESPONSABLE_NO_INSCRIPTO / NO_RESPONSABLE): no
  // discriminan IVA → Factura B como "Sujeto No Categorizado".
  if (c.includes('no inscripto') || c.includes('no responsable')) {
    return { letra: 'B', receptor: { condicionIvaId: 7, docTipo: tieneCuit ? DOC_TIPO.CUIT : DOC_TIPO.CONSUMIDOR_FINAL, docNro: tieneCuit ? doc : '0' } }
  }
  if (c.includes('inscripto') || c === 'ri') {
    return { letra: 'A', receptor: { condicionIvaId: 1, docTipo: DOC_TIPO.CUIT, docNro: doc } }
  }
  if (c.includes('monotrib')) {
    return { letra: 'A', receptor: { condicionIvaId: 6, docTipo: DOC_TIPO.CUIT, docNro: doc } }
  }
  if (c.includes('exento')) {
    return { letra: 'B', receptor: { condicionIvaId: 4, docTipo: tieneCuit ? DOC_TIPO.CUIT : DOC_TIPO.CONSUMIDOR_FINAL, docNro: tieneCuit ? doc : '0' } }
  }
  if (c.includes('no alcanzado') || c.includes('no_alcanzado')) {
    return { letra: 'B', receptor: { condicionIvaId: 15, docTipo: tieneCuit ? DOC_TIPO.CUIT : DOC_TIPO.CONSUMIDOR_FINAL, docNro: tieneCuit ? doc : '0' } }
  }
  if (c.includes('no categorizado') || c.includes('no_categorizado')) {
    return { letra: 'B', receptor: { condicionIvaId: 7, docTipo: tieneCuit ? DOC_TIPO.CUIT : DOC_TIPO.CONSUMIDOR_FINAL, docNro: tieneCuit ? doc : '0' } }
  }
  // Consumidor final (default)
  if (tieneCuit) {
    return { letra: 'B', receptor: { condicionIvaId: 5, docTipo: DOC_TIPO.CUIT, docNro: doc } }
  }
  if (doc.length >= 7 && doc.length <= 8) {
    return { letra: 'B', receptor: { condicionIvaId: 5, docTipo: DOC_TIPO.DNI, docNro: doc } }
  }
  return { letra: 'B', receptor: { condicionIvaId: 5, docTipo: DOC_TIPO.CONSUMIDOR_FINAL, docNro: '0' } }
}

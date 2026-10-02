/**
 * Emisión de comprobantes de exportación (Factura E 19; a futuro NC/ND E)
 * por WSFEX. Capa por encima de wsfex.ts, independiente del modelo de datos:
 * recibe un ExportacionInput ya resuelto (receptor, ítems en USD sin IVA,
 * datos de exportación) y callbacks de persistencia.
 *
 * Diseño: docs/FACTURA-E-WSFEX-PLAN.md (secciones 4, 6 y 7).
 *
 * Idempotencia (lo más caro de equivocar):
 *  1. Lock en memoria único 'wsfex' (el Cmp.Id es único por CUIT).
 *  2. No se emite si hay otro comprobante PENDIENTE o INCIERTO en el PV.
 *  3. Número = FEXGetLast_CMP + 1; Id = max(FEXGetLast_ID, máx. Id en la DB) + 1.
 *  4. Se arma el request (puro) y se GUARDA como PENDIENTE con su Id ANTES de
 *     llamar a FEXAuthorize. Si no se puede guardar, no se llama a ARCA.
 *  5. FEXAuthorize:
 *     - 'A' con CAE → AUTORIZADA (Reproceso 'S' si ARCA devolvió lo ya hecho).
 *     - 'R' / FEXErr → RECHAZADA (no consume número).
 *     - Sin respuesta (timeout, red, HTML de un proxy) → UN reintento con el
 *       MISMO cuerpo y el MISMO Id. Si sigue sin respuesta → FEXGetCMP:
 *       existe y coincide → AUTORIZADA (recuperada); si no → INCIERTA, que
 *       bloquea nuevas emisiones hasta reconciliar (reenviando el mismo Id).
 *       Si el reintento vuelve rechazado, también se confirma con FEXGetCMP
 *       y, si no figura, queda INCIERTA (el primer envío pudo seguir en proceso).
 *     - SOAP Fault o error interno de ARCA (500/501/502) en el primer envío
 *       (sin corte previo) → FEXGetCMP: si no existe, RECHAZADA (ARCA terminó
 *       de procesar sin autorizar).
 *     Nunca se manda un Id nuevo para un comprobante de resultado desconocido.
 *  6. La fecha (Fecha_cbte) se calcula en hora argentina, no la del servidor.
 */
import { getArcaConfig } from './config'
import type { EmisionAutorizada, EmisionRechazada } from './emitir'
import {
  FEX_CBTE,
  FEX_OPCIONAL,
  IDIOMA,
  INCOTERMS_EXPORTA_SIMPLE,
  INCOTERMS_SIN_FLETE,
  MONEDA_FEX,
  TIPO_EXPO,
  UMED_UNIDADES,
  esIncoterm,
  type ReceptorExportacion,
} from './fex-params'
import { formatNroComprobante, type ArcaObservacion } from './wsfe'
import {
  FEX_ERR_TRANSITORIOS,
  FexFaultError,
  buildFexAuthXml,
  buildFexAuthorizeBody,
  buildFexEnvelope,
  fechaDesdeYmd,
  fechaYmdAR,
  fexAuthorize,
  fexGetCmp,
  fexGetLastCmp,
  fexGetLastId,
  fmtDecimal,
  formatFexErrores,
  type FexAuthorizeResult,
  type FexCmp,
  type FexCmpAsoc,
  type FexCmpConsultado,
  type FexItem,
  type FexOpcional,
  type FexPermiso,
} from './wsfex'
import { logger } from '@/lib/logger'

export { buildFexAuthorizeBody } from './wsfex'

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

export type RegimenExportacion = 'EXPORTA_SIMPLE' | 'DESPACHANTE'
export type ClaseExportacion = 'FACTURA' | 'NOTA_CREDITO' | 'NOTA_DEBITO'

export interface ItemExportacionInput {
  /** Pro_codigo (SKU), máx. 50 */
  codigo?: string | null
  /** Pro_ds, máx. 4000 */
  descripcion: string
  cantidad: number
  /** Pro_umed (default 7 = unidades) */
  umed?: number
  /** USD sin IVA */
  precioUnitario: number
  /** MONTO de la bonificación en USD (no porcentaje) */
  bonificacion?: number
  /**
   * Línea agregada a mano (flete internacional, seguro): no integra el FOB
   * de la mercadería ni comisiona.
   */
  manual?: boolean
  /** Si se informa, la cantidad no puede superarla (pendiente de facturar de la cotización) */
  cantidadPendiente?: number
}

export interface PermisoEmbarqueInput {
  idPermiso: string
  /** Código de país de destino de la mercadería (DST_pais) */
  dstMerc: number
}

export interface AsociadoExportacionInput {
  cbteTipo: number
  puntoVenta: number
  numero: number
  /** CUIT del emisor del comprobante asociado */
  cuit: string
}

export interface ExportacionInput {
  /** Default FACTURA */
  clase?: ClaseExportacion
  regimen: RegimenExportacion
  /** Tipo_expo (default 1 = bienes) */
  tipoExpo?: number
  /** Default: ARCA_PUNTO_VENTA_EXPO */
  puntoVenta?: number
  /** Default: ahora. Tiene que ser hoy en hora argentina. */
  fecha?: Date
  receptor: ReceptorExportacion
  /** v1: solo USD (Moneda_Id 'DOL') */
  moneda: 'USD'
  /** Cotización oficial de ARCA (FEXGetPARAM_Ctz) */
  cotizacion: number
  /** CanMisMonExt: el cliente paga en dólares (default true). No va en NC/ND. */
  cancelaEnMonedaExtranjera?: boolean
  items: ItemExportacionInput[]
  /** Forma_pago, máx. 50 (obligatoria en facturas) */
  formaPago?: string
  incoterm?: string
  /** Incoterms_Ds: lugar, máx. 20 (ej. "Santiago") */
  incotermLugar?: string
  /** Idioma_cbte (default 1 = español) */
  idioma?: number
  /** Obs_comerciales, máx. 4000 */
  obsComerciales?: string
  /** Obs, máx. 1000 */
  obs?: string
  /** Exporta Simple: N° de DES y FOB del DES (opcionales 2401/2402) */
  exportaSimple?: {
    desNumero: string
    fobUSD: number
    /** Solo NC/ND (fase 2): FOB de la factura original, tope del FOB a descontar (ARCA 2023) */
    fobOriginalUSD?: number
  }
  /** Despachante (fase 3): 'S' con permisos o 'N' (factura antes del permiso) */
  permisoExistente?: 'S' | 'N'
  permisos?: PermisoEmbarqueInput[]
  /** NC/ND E (fase 2): exactamente un comprobante asociado */
  asociados?: AsociadoExportacionInput[]
  /** Fecha_pago yyyymmdd (obligatoria en servicios) */
  fechaPago?: string
  /** Actividades del emisor (FEXGetPARAM_Actividades). Default: no se informan. */
  actividades?: number[]
}

export interface TotalesExportacion {
  /** Imp_total */
  totalUSD: number
  /** Suma de las líneas de mercadería (no manuales): el FOB de Exporta Simple y la base de comisión */
  mercaderiaUSD: number
  /** Suma de las líneas manuales (flete, seguro) */
  manualUSD: number
}

export interface FexRequest {
  cmp: FexCmp
  totales: TotalesExportacion
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

/** Datos inválidos: no se llamó a ARCA. `errores` trae todos los problemas juntos. */
export class ExportacionValidacionError extends Error {
  constructor(public readonly errores: string[]) {
    super(errores.join(' · '))
    this.name = 'ExportacionValidacionError'
  }
}

/** Hay un comprobante PENDIENTE/INCIERTO o la numeración no cierra: no se emite hasta reconciliar. */
export class ExportacionBloqueadaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportacionBloqueadaError'
  }
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

export const ESTADO_FEX = {
  PENDIENTE: 'PENDIENTE',
  AUTORIZADA: 'AUTORIZADA',
  RECHAZADA: 'RECHAZADA',
  INCIERTA: 'INCIERTA',
} as const
export type EstadoFex = (typeof ESTADO_FEX)[keyof typeof ESTADO_FEX]

export function cbteTipoExportacion(clase: ClaseExportacion): number {
  if (clase === 'NOTA_CREDITO') return FEX_CBTE.NOTA_CREDITO_E
  if (clase === 'NOTA_DEBITO') return FEX_CBTE.NOTA_DEBITO_E
  return FEX_CBTE.FACTURA_E
}

/** Número interno de la Invoice: 'E-0010-00000001' (NC: 'NCE-…', ND: 'NDE-…'). */
export function numeroInternoExportacion(cbteTipo: number, puntoVenta: number, numero: number): string {
  const prefijo = cbteTipo === FEX_CBTE.NOTA_CREDITO_E ? 'NCE' : cbteTipo === FEX_CBTE.NOTA_DEBITO_E ? 'NDE' : 'E'
  return `${prefijo}-${formatNroComprobante(puntoVenta, numero)}`
}

/** N° de DES como lo espera ARCA: sin espacios y en mayúsculas. */
export function normalizarDes(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/\s+/g, '')
}

/**
 * Formato del DES, laxo a propósito: el manual dice 11 caracteres
 * alfanuméricos y el ejemplo oficial ('2133ECSI12') tiene 10.
 */
export const DES_REGEX = /^[0-9A-Z]{8,11}$/

/** Permiso de embarque del despachante (fase 3), ej. 26001EC01000123A */
export const PERMISO_EMBARQUE_REGEX = /^\d{5}[A-Z]{2}[A-Z0-9]{2}\d{6}[A-Z]$/

/** USD → centavos enteros, redondeo half-up sin errores de coma flotante (1.005 → 101). */
export function aCentavos(n: number): number {
  if (!Number.isFinite(n)) return NaN
  const [ent, dec = ''] = Math.abs(n).toFixed(8).split('.')
  const c = Number(ent) * 100 + Number(dec.slice(0, 2)) + (Number(dec.slice(2)) >= 500000 ? 1 : 0)
  return n < 0 ? -c : c
}

function redondear(n: number, decimales: number): number {
  return Number(n.toFixed(decimales))
}

const fmtUsd = (centavos: number) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(centavos / 100)

const limpiar = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------------------
// Armado + validaciones (sección 6 del plan)
// ---------------------------------------------------------------------------

function armar(
  input: ExportacionInput,
  numero: number,
  id: number,
  ahora: Date
): { errores: string[]; request: FexRequest | null } {
  const errores: string[] = []
  const err = (m: string) => errores.push(m)

  const clase: ClaseExportacion = input.clase ?? 'FACTURA'
  const esFactura = clase === 'FACTURA'
  const cbteTipo = cbteTipoExportacion(clase)
  const tipoExpo = input.tipoExpo ?? TIPO_EXPO.BIENES
  const idioma = input.idioma ?? IDIOMA.ESPANOL
  const pv = input.puntoVenta ?? 0

  // --- Numeración y configuración ---
  if (!Number.isInteger(pv) || pv <= 0) {
    err('Factura E no configurada: falta ARCA_PUNTO_VENTA_EXPO (punto de venta de exportación)')
  }
  if (!Number.isInteger(numero) || numero <= 0) err(`Número de comprobante inválido (${numero})`)
  if (!Number.isInteger(id) || id <= 0) err(`Id de requerimiento inválido (${id})`)
  if (!(Object.values(TIPO_EXPO) as number[]).includes(tipoExpo)) err(`Tipo de exportación inválido (${tipoExpo})`)
  if (!(Object.values(IDIOMA) as number[]).includes(idioma)) err(`Idioma del comprobante inválido (${idioma})`)

  // --- Receptor ---
  const r = input.receptor
  const cliente = limpiar(r?.cliente)
  const domicilio = limpiar(r?.domicilio)
  const cuitPais = (r?.cuitPais ?? '').replace(/\D/g, '')
  const idImpositivo = limpiar(r?.idImpositivo)
  if (!cliente) err('Falta la razón social del cliente')
  else if (cliente.length > 200) err('La razón social del cliente supera los 200 caracteres')
  if (!domicilio) err('Falta el domicilio del cliente')
  else if (domicilio.length > 300) err('El domicilio del cliente supera los 300 caracteres')
  if (!r || !Number.isInteger(r.dstCmp) || r.dstCmp <= 0) err('Falta el país de destino con código de ARCA (Dst_cmp)')
  if (!cuitPais && !idImpositivo) err('El cliente necesita CUIT país o ID impositivo (RUT, RUC...) (ARCA 1580)')
  if (cuitPais && cuitPais.length !== 11) err(`CUIT país inválido (${r?.cuitPais})`)
  if (idImpositivo.length > 50) err('El ID impositivo del cliente supera los 50 caracteres')

  // --- Moneda y fecha ---
  if ((input.moneda as string) !== 'USD') err('La Factura E se emite solo en dólares (USD) en esta versión')
  const cotizacion = Number(input.cotizacion)
  if (!(Number.isFinite(cotizacion) && cotizacion > 0)) err('Falta la cotización oficial del dólar de ARCA (Moneda_ctz)')
  const fechaInvalida = input.fecha !== undefined && !(input.fecha instanceof Date && !isNaN(input.fecha.getTime()))
  if (fechaInvalida) err('Fecha del comprobante inválida')
  const fechaCbte = fechaYmdAR(input.fecha && !fechaInvalida ? input.fecha : ahora)
  const hoy = fechaYmdAR(ahora)
  if (fechaCbte !== hoy) {
    err(`La fecha del comprobante (${fechaCbte}) tiene que ser la de hoy en hora argentina (${hoy}) (ARCA 1500)`)
  }

  // --- Ítems (importes en centavos enteros) ---
  const items: FexItem[] = []
  let totalCent = 0
  let mercaderiaCent = 0
  let manualCent = 0
  if (!input.items?.length) err('El comprobante no tiene ítems')
  ;(input.items ?? []).forEach((it, i) => {
    const desc = (it.descripcion ?? '').trim()
    const nombre = `Ítem ${i + 1}${desc ? ` (${desc.slice(0, 40)})` : ''}`
    const codigo = (it.codigo ?? '').trim()
    const qty = redondear(Number(it.cantidad), 6)
    const precio = redondear(Number(it.precioUnitario), 6)
    const bonif = Number(it.bonificacion ?? 0)
    const umed = it.umed ?? UMED_UNIDADES
    let ok = true
    if (!desc) {
      err(`${nombre}: falta la descripción`)
      ok = false
    } else if (desc.length > 4000) err(`${nombre}: la descripción supera los 4000 caracteres`)
    if (codigo.length > 50) err(`${nombre}: el código supera los 50 caracteres`)
    if (!Number.isInteger(umed) || umed <= 0) err(`${nombre}: unidad de medida inválida (${it.umed})`)
    if (!(Number.isFinite(qty) && qty > 0)) {
      err(`${nombre}: la cantidad tiene que ser mayor a cero`)
      ok = false
    } else if (it.cantidadPendiente !== undefined && qty > it.cantidadPendiente + 1e-9) {
      err(`${nombre}: la cantidad (${qty}) supera la pendiente de facturar (${it.cantidadPendiente})`)
    }
    if (!(Number.isFinite(precio) && precio > 0)) {
      err(`${nombre}: el precio unitario tiene que ser mayor a cero`)
      ok = false
    }
    if (!Number.isFinite(bonif) || bonif < 0) {
      err(`${nombre}: la bonificación no puede ser negativa (ARCA 1811)`)
      ok = false
    }
    if (!ok) return
    const brutoCent = aCentavos(qty * precio)
    const bonifCent = aCentavos(bonif)
    if (bonifCent > brutoCent) {
      err(`${nombre}: la bonificación (USD ${fmtUsd(bonifCent)}) supera el importe del ítem (USD ${fmtUsd(brutoCent)}) (ARCA 1812)`)
      return
    }
    const itemCent = brutoCent - bonifCent
    if (itemCent <= 0) {
      err(`${nombre}: el total del ítem tiene que ser mayor a cero`)
      return
    }
    totalCent += itemCent
    if (it.manual) manualCent += itemCent
    else mercaderiaCent += itemCent
    items.push({
      Pro_codigo: codigo || undefined,
      Pro_ds: desc,
      Pro_qty: qty,
      Pro_umed: umed,
      Pro_precio_uni: precio,
      Pro_bonificacion: bonifCent / 100,
      Pro_total_item: itemCent / 100,
    })
  })

  // --- Condiciones comerciales ---
  const formaPago = limpiar(input.formaPago)
  if (esFactura && !formaPago) err('Falta la forma de pago (ARCA 1620)')
  if (formaPago.length > 50) err('La forma de pago supera los 50 caracteres (ARCA 1620)')

  const incoterm = (input.incoterm ?? '').trim().toUpperCase()
  if (!incoterm) {
    if (esFactura && tipoExpo === TIPO_EXPO.BIENES) err('Falta el Incoterm (ARCA 1640)')
  } else if (!esIncoterm(incoterm)) {
    err(`Incoterm inválido: ${incoterm} (ARCA 1640)`)
  } else if (input.regimen === 'EXPORTA_SIMPLE' && !INCOTERMS_EXPORTA_SIMPLE.includes(incoterm)) {
    err(`El Incoterm ${incoterm} no está habilitado para Exporta Simple (usar ${INCOTERMS_EXPORTA_SIMPLE.join(', ')})`)
  }
  if (manualCent > 0 && esIncoterm(incoterm) && INCOTERMS_SIN_FLETE.includes(incoterm)) {
    err(`Con ${incoterm} el flete lo paga el cliente: una línea de flete o seguro solo corresponde con CPT, CIP o DAP`)
  }
  const incotermLugar = limpiar(input.incotermLugar)
  if (incotermLugar.length > 20) err('El lugar del Incoterm supera los 20 caracteres')
  if (incotermLugar && !incoterm) err('Se informó el lugar del Incoterm sin el Incoterm')

  const obsComerciales = (input.obsComerciales ?? '').trim()
  if (obsComerciales.length > 4000) err('Las observaciones comerciales superan los 4000 caracteres')
  const obs = (input.obs ?? '').trim()
  if (obs.length > 1000) err('Las observaciones superan los 1000 caracteres')

  const fechaPago = (input.fechaPago ?? '').trim()
  if (fechaPago && !/^\d{8}$/.test(fechaPago)) err(`Fecha de pago inválida (${fechaPago}): va como yyyymmdd`)
  if (esFactura && tipoExpo === TIPO_EXPO.SERVICIOS && !fechaPago) err('La exportación de servicios requiere fecha de pago')

  // --- Comprobantes asociados (NC/ND E) ---
  let cmpsAsoc: FexCmpAsoc[] | undefined
  const asociados = input.asociados ?? []
  if (!esFactura && asociados.length !== 1) {
    err('Una nota de crédito o débito E tiene que asociar exactamente un comprobante')
  }
  if (asociados.length) {
    cmpsAsoc = asociados.map((a, i) => {
      const cuit = String(a.cuit ?? '').replace(/\D/g, '')
      if (!Number.isInteger(a.cbteTipo) || !Number.isInteger(a.puntoVenta) || !Number.isInteger(a.numero) || a.numero <= 0) {
        err(`Comprobante asociado ${i + 1}: tipo, punto de venta o número inválido`)
      }
      if (cuit.length !== 11) err(`Comprobante asociado ${i + 1}: CUIT del emisor inválido`)
      return { Cbte_tipo: a.cbteTipo, Cbte_punto_vta: a.puntoVenta, Cbte_nro: a.numero, Cbte_cuit: cuit }
    })
  }

  // --- Régimen ---
  let permisoExistente: 'S' | 'N' | '' = ''
  let permisos: FexPermiso[] | undefined
  const opcionales: FexOpcional[] = []

  if (input.regimen === 'EXPORTA_SIMPLE') {
    if (tipoExpo !== TIPO_EXPO.BIENES) err('Exporta Simple exige Tipo_expo 1 (exportación definitiva de bienes)')
    if (input.permisos?.length) err('Exporta Simple no lleva permisos de embarque (ARCA 2056)')
    if (input.permisoExistente === 'S') err('Exporta Simple va sin permiso de embarque (Permiso_existente N)')
    // Deducido del manual: 'S' exige Permisos (1720) y 2056 prohíbe Permisos con Exporta Simple
    permisoExistente = esFactura ? 'N' : ''

    const es = input.exportaSimple
    if (!es) {
      err('Faltan el N° de DES y el FOB del DES (Exporta Simple)')
    } else {
      const fob = Number(es.fobUSD)
      const fobCent = aCentavos(fob)
      const fobValido = Number.isFinite(fob) && (esFactura ? fob > 0 : fob >= 0)
      if (!fobValido) {
        err(esFactura ? 'El FOB del DES tiene que ser mayor a cero' : 'El FOB a informar no puede ser negativo')
      } else if (Math.abs(fob * 100 - fobCent) > 1e-6) {
        err('El FOB del DES tiene que tener como máximo 2 decimales')
      } else if (fobCent > totalCent) {
        err(`El FOB (USD ${fmtUsd(fobCent)}) supera el total del comprobante (USD ${fmtUsd(totalCent)}) (ARCA 2021)`)
      }
      if (esFactura) {
        const des = normalizarDes(es.desNumero)
        if (!DES_REGEX.test(des)) {
          err(`N° de DES inválido ("${es.desNumero ?? ''}"): 8 a 11 letras o números, copiado tal cual del portal Exporta Simple`)
        }
        if (fobValido && fobCent !== mercaderiaCent) {
          err(
            `El FOB del DES (USD ${fmtUsd(fobCent)}) no coincide con la mercadería facturada (USD ${fmtUsd(mercaderiaCent)}): ` +
              'tienen que ser iguales al centavo. Corregí el DES o los ítems (ARCA 2022/2060)'
          )
        }
        opcionales.push({ Id: FEX_OPCIONAL.DES, Valor: des })
      } else if (fobValido && es.fobOriginalUSD !== undefined && fobCent > aCentavos(Number(es.fobOriginalUSD))) {
        err('El FOB de la nota supera el FOB de la factura original (ARCA 2023)')
      }
      // NC/ND en Exporta Simple: solo el 2402, nunca el 2401 (ARCA 2057)
      if (fobValido) opcionales.push({ Id: FEX_OPCIONAL.FOB_DES, Valor: fmtDecimal(fobCent / 100, 2, 2) })
    }
  } else if (input.regimen === 'DESPACHANTE') {
    if (input.exportaSimple) err('Con despachante no van los datos del DES (opcionales 2401/2402)')
    if (esFactura && tipoExpo === TIPO_EXPO.BIENES) {
      if (input.permisoExistente !== 'S' && input.permisoExistente !== 'N') {
        err('Indicar si ya existe el permiso de embarque (S/N)')
      } else {
        permisoExistente = input.permisoExistente
      }
      if (input.permisoExistente === 'S') {
        if (!input.permisos?.length) err('Con permiso existente hay que informar al menos un permiso de embarque (ARCA 1720)')
        permisos = (input.permisos ?? []).map((p, i) => {
          const idPermiso = (p.idPermiso ?? '').toUpperCase().replace(/\s+/g, '')
          if (!PERMISO_EMBARQUE_REGEX.test(idPermiso)) err(`Permiso de embarque ${i + 1} con formato inválido (${p.idPermiso})`)
          if (!Number.isInteger(p.dstMerc) || p.dstMerc <= 0) err(`Permiso de embarque ${i + 1}: falta el país de destino de la mercadería`)
          return { Id_permiso: idPermiso, Dst_merc: p.dstMerc }
        })
      } else if (input.permisos?.length) {
        err('Sin permiso existente no se informan permisos de embarque')
      }
    } else if (input.permisoExistente || input.permisos?.length) {
      err('El permiso de embarque solo va en facturas de exportación de bienes')
    }
  } else {
    err(`Régimen de exportación desconocido (${String(input.regimen)})`)
  }

  if (items.length && totalCent <= 0) err('El total del comprobante tiene que ser mayor a cero')
  if (errores.length) return { errores, request: null }

  const cmp: FexCmp = {
    Id: id,
    Fecha_cbte: fechaCbte,
    Cbte_Tipo: cbteTipo,
    Punto_vta: pv,
    Cbte_nro: numero,
    Tipo_expo: tipoExpo,
    Permiso_existente: permisoExistente || undefined,
    Permisos: permisos?.length ? permisos : undefined,
    Dst_cmp: r.dstCmp,
    Cliente: cliente,
    Cuit_pais_cliente: cuitPais || undefined,
    Domicilio_cliente: domicilio,
    Id_impositivo: idImpositivo || undefined,
    Moneda_Id: MONEDA_FEX.DOLAR,
    Moneda_ctz: cotizacion,
    // No va en NC/ND (ARCA 1605)
    CanMisMonExt: esFactura ? (input.cancelaEnMonedaExtranjera === false ? 'N' : 'S') : undefined,
    Obs_comerciales: obsComerciales || undefined,
    Imp_total: totalCent / 100,
    Obs: obs || undefined,
    Cmps_asoc: cmpsAsoc,
    Forma_pago: formaPago || undefined,
    Incoterms: incoterm || undefined,
    Incoterms_Ds: incotermLugar || undefined,
    Idioma_cbte: idioma,
    Items: items,
    Opcionales: opcionales.length ? opcionales : undefined,
    Fecha_pago: fechaPago || undefined,
    Actividades: input.actividades?.length ? input.actividades.map((a) => ({ Id: a })) : undefined,
  }
  return {
    errores,
    request: {
      cmp,
      totales: { totalUSD: totalCent / 100, mercaderiaUSD: mercaderiaCent / 100, manualUSD: manualCent / 100 },
    },
  }
}

/**
 * Lista de problemas del comprobante (vacía si está todo bien). Sirve para
 * avisar en el diálogo antes de consultar ARCA; usa número e Id ficticios.
 */
export function validarExportacion(input: ExportacionInput, opts: { ahora?: Date } = {}): string[] {
  return armar(input, 1, 1, opts.ahora ?? new Date()).errores
}

/**
 * Arma el Cmp de FEXAuthorize. PURA: con todas las validaciones de la
 * sección 6 del plan; lanza ExportacionValidacionError con la lista completa.
 */
export function buildFexRequest(
  input: ExportacionInput,
  numero: number,
  id: number,
  opts: { ahora?: Date } = {}
): FexRequest {
  const { errores, request } = armar(input, numero, id, opts.ahora ?? new Date())
  if (errores.length || !request) throw new ExportacionValidacionError(errores)
  return request
}

/** ¿El comprobante leído con FEXGetCMP es el que mandamos? (Id, total, fecha y receptor) */
export function coincideConEnviado(c: FexCmpConsultado, cmp: FexCmp): boolean {
  if (!c.Cae) return false
  if (c.Resultado && c.Resultado !== 'A') return false
  if (c.Id && c.Id !== cmp.Id) return false
  if (Math.abs(c.Imp_total - cmp.Imp_total) >= 0.005) return false
  if (c.Fecha_cbte !== cmp.Fecha_cbte) return false
  const normId = (s: string | undefined) => (s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (cmp.Id_impositivo && normId(c.Id_impositivo) !== normId(cmp.Id_impositivo)) return false
  if (cmp.Cuit_pais_cliente && c.Cuit_pais_cliente && c.Cuit_pais_cliente !== cmp.Cuit_pais_cliente) return false
  return true
}

// ---------------------------------------------------------------------------
// Persistencia y cliente ARCA inyectables
// ---------------------------------------------------------------------------

export interface ReservaExportacion {
  fexId: number
  cbteTipo: number
  puntoVenta: number
  cbteNumero: number
  cmp: FexCmp
  /** Cuerpo <Cmp> exacto que se manda (y se reenvía igual ante un corte) */
  cmpXml: string
  totales: TotalesExportacion
  input: ExportacionInput
}

export interface DatosAutorizacion {
  cae: string
  caeVencimiento: Date
  /** Fecha_cbte yyyymmdd */
  fechaCbte: string
  reproceso: boolean
  /** true si el CAE se obtuvo con FEXGetCMP después de un corte */
  recuperado: boolean
  motivosObs: string | null
  response: unknown
}

export interface PersistenciaExportacion {
  /** Comprobante PENDIENTE o INCIERTO en el PV (bloquea nuevas emisiones), o null. */
  buscarBloqueante(puntoVenta: number): Promise<{ fexId: number; estado: string; cbteNumero: number } | null>
  /** Mayor Cmp.Id guardado (0 si no hay ninguno). */
  maxFexId(): Promise<number>
  /**
   * Opcional (recomendado en prod, donde el PV de exportación es exclusivo
   * del ERP): mayor número AUTORIZADO en la DB para el PV y tipo. Si no
   * coincide con FEXGetLast_CMP, hay un comprobante que el ERP no conoce y
   * no se emite hasta reconciliar.
   */
  ultimoNumeroAutorizado?(puntoVenta: number, cbteTipo: number): Promise<number>
  /** INSERT en estado PENDIENTE con request e Id, ANTES de llamar a ARCA. Si lanza, no se llama. */
  reservar(r: ReservaExportacion): Promise<void>
  marcarAutorizada(fexId: number, d: DatosAutorizacion): Promise<void>
  marcarRechazada(fexId: number, d: { errores: ArcaObservacion[]; mensaje: string; response: unknown }): Promise<void>
  marcarIncierta(fexId: number, d: { mensaje: string; response: unknown }): Promise<void>
}

/** Métodos de WSFEX que usa la emisión (inyectables para tests). */
export interface FexCliente {
  getLastCmp(cbteTipo: number, puntoVenta: number): Promise<number>
  getLastId(): Promise<number>
  /** Recibe el cuerpo <Cmp> ya armado */
  authorize(cmpXml: string): Promise<FexAuthorizeResult>
  getCmp(cbteTipo: number, puntoVenta: number, numero: number): Promise<FexCmpConsultado | null>
}

export const clienteWsfex: FexCliente = {
  getLastCmp: fexGetLastCmp,
  getLastId: fexGetLastId,
  authorize: (cmpXml) => fexAuthorize(cmpXml),
  getCmp: fexGetCmp,
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export interface ExportacionAutorizada extends EmisionAutorizada {
  estado: 'AUTORIZADA'
  fexId: number
  /** ARCA devolvió lo ya procesado para ese Id (reenvío tras un corte) */
  reproceso: boolean
  motivosObs: string | null
  /** 'E-0010-00000001' */
  numeroInterno: string
  cmp: FexCmp
  totales: TotalesExportacion
  /** false si ARCA autorizó pero no se pudo marcar AUTORIZADA en la DB (queda para reconciliar) */
  persistido: boolean
}

export interface ExportacionNoAutorizada extends EmisionRechazada {
  estado: 'RECHAZADA' | 'INCIERTA'
  fexId: number
  cmp: FexCmp
}

export type ExportacionResult = ExportacionAutorizada | ExportacionNoAutorizada

export interface EmitirExportacionOpts {
  cliente?: FexCliente
  /** Reloj inyectable (tests) */
  ahora?: () => Date
  /** Espera antes del reintento con el mismo Id (default 3 s) */
  esperaReintentoMs?: number
}

// ---------------------------------------------------------------------------
// Lock en memoria (pm2 corre una sola instancia; la DB ataja el resto)
// ---------------------------------------------------------------------------

let colaWsfex: Promise<unknown> = Promise.resolve()

function conLockWsfex<T>(fn: () => Promise<T>): Promise<T> {
  const run = colaWsfex.then(fn, fn)
  colaWsfex = run.catch(() => undefined)
  return run
}

function resolverPuntoVenta(input: ExportacionInput): number {
  const pv = input.puntoVenta ?? getArcaConfig().puntoVentaExportacion
  if (!pv) {
    throw new ExportacionValidacionError([
      'Factura E no configurada: falta ARCA_PUNTO_VENTA_EXPO (punto de venta de exportación)',
    ])
  }
  return pv
}

// ---------------------------------------------------------------------------
// Emisión
// ---------------------------------------------------------------------------

type Intento =
  | { tipo: 'respuesta'; r: FexAuthorizeResult }
  /** SOAP Fault: ARCA respondió (terminó de procesar) con una excepción */
  | { tipo: 'fault'; error: Error }
  /** Timeout, red, respuesta sin sobre SOAP: no se sabe si ARCA lo procesó */
  | { tipo: 'sin-respuesta'; error: Error }

async function intentar(cliente: FexCliente, cmpXml: string): Promise<Intento> {
  try {
    return { tipo: 'respuesta', r: await cliente.authorize(cmpXml) }
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e))
    return e instanceof FexFaultError ? { tipo: 'fault', error } : { tipo: 'sin-respuesta', error }
  }
}

interface Contexto {
  fexId: number
  cbteTipo: number
  pv: number
  numero: number
  cmp: FexCmp
  totales: TotalesExportacion
  persistencia: PersistenciaExportacion
}

async function autorizada(
  ctx: Contexto,
  d: Omit<DatosAutorizacion, 'caeVencimiento'> & { vencimientoYmd: string; eventos?: ArcaObservacion[] }
): Promise<ExportacionAutorizada> {
  const caeVencimiento = fechaDesdeYmd(d.vencimientoYmd)
  const fechaCbte = d.fechaCbte || ctx.cmp.Fecha_cbte
  let persistido = true
  try {
    await ctx.persistencia.marcarAutorizada(ctx.fexId, {
      cae: d.cae,
      caeVencimiento,
      fechaCbte,
      reproceso: d.reproceso,
      recuperado: d.recuperado,
      motivosObs: d.motivosObs,
      response: d.response,
    })
  } catch (e) {
    persistido = false
    logger.error('[WSFEX] CAE obtenido pero no se pudo marcar AUTORIZADA en la DB: queda para reconciliar', {
      fexId: ctx.fexId,
      numero: ctx.numero,
      cae: d.cae,
      error: (e as Error).message,
    })
  }
  const observaciones: ArcaObservacion[] = [
    ...(d.motivosObs ? [{ Code: 0, Msg: d.motivosObs }] : []),
    ...(d.eventos ?? []),
  ]
  return {
    ok: true,
    estado: 'AUTORIZADA',
    cbteTipo: ctx.cbteTipo,
    puntoVenta: ctx.pv,
    numero: ctx.numero,
    numeroFormateado: formatNroComprobante(ctx.pv, ctx.numero),
    numeroInterno: numeroInternoExportacion(ctx.cbteTipo, ctx.pv, ctx.numero),
    cae: d.cae,
    caeVencimiento,
    fecha: fechaDesdeYmd(fechaCbte),
    observaciones,
    recuperado: d.recuperado,
    reproceso: d.reproceso,
    motivosObs: d.motivosObs,
    fexId: ctx.fexId,
    cmp: ctx.cmp,
    totales: ctx.totales,
    persistido,
  }
}

async function noAutorizada(
  ctx: Contexto,
  estado: 'RECHAZADA' | 'INCIERTA',
  errores: ArcaObservacion[],
  mensaje: string,
  response: unknown
): Promise<ExportacionNoAutorizada> {
  try {
    if (estado === 'RECHAZADA') await ctx.persistencia.marcarRechazada(ctx.fexId, { errores, mensaje, response })
    else await ctx.persistencia.marcarIncierta(ctx.fexId, { mensaje, response })
  } catch (e) {
    // La fila queda PENDIENTE: igual bloquea nuevas emisiones hasta reconciliar
    logger.error(`[WSFEX] No se pudo marcar ${estado} el Id ${ctx.fexId} en la DB (queda PENDIENTE)`, (e as Error).message)
  }
  if (estado === 'INCIERTA') logger.error(`[WSFEX] Comprobante INCIERTO Id ${ctx.fexId} N° ${ctx.numero}: ${mensaje}`)
  return {
    ok: false,
    estado,
    cbteTipo: ctx.cbteTipo,
    puntoVenta: ctx.pv,
    numero: ctx.numero,
    errores,
    mensaje,
    fexId: ctx.fexId,
    cmp: ctx.cmp,
  }
}

/**
 * Respuesta "rara" o sin respuesta: se confirma contra FEXGetCMP. `huboCorte`
 * = el primer envío quedó sin respuesta: aunque el reintento vuelva con un
 * error, el primero pudo seguir en proceso, así que no se concluye RECHAZADA.
 */
async function recuperar(
  cliente: FexCliente,
  ctx: Contexto,
  intento: Intento,
  huboCorte: boolean
): Promise<ExportacionResult> {
  const detalle =
    intento.tipo === 'respuesta'
      ? formatFexErrores(intento.r.errores) || `Resultado '${intento.r.Resultado}' sin CAE`
      : intento.error.message
  // Acá llegan SOAP Fault, errores internos de ARCA (500/501/502), 'A' sin CAE
  // y cortes: ARCA pudo haber grabado el comprobante igual (o grabarlo con
  // demora), así que si FEXGetCMP no lo encuentra NO se da por rechazado ni se
  // libera el número: queda INCIERTO y se resuelve reenviando el MISMO Id
  // (reproceso) con scripts/arca-fex-reconciliar.ts. Los rechazos limpios del
  // único envío ('R' / FEXErr no transitorio) se resuelven antes, en emitirExportacion.
  const respuesta = intento.tipo === 'respuesta' ? intento.r.raw : { error: intento.error.message }

  let c: FexCmpConsultado | null
  try {
    c = await cliente.getCmp(ctx.cbteTipo, ctx.pv, ctx.numero)
  } catch (e) {
    return noAutorizada(
      ctx,
      'INCIERTA',
      [],
      `No se pudo confirmar en ARCA (FEXGetCMP: ${(e as Error).message}) después de: ${detalle}. ` +
        'Reconciliar reenviando el MISMO Id; no emitir otra',
      respuesta
    )
  }
  if (c && coincideConEnviado(c, ctx.cmp)) {
    logger.warn(`[WSFEX] CAE recuperado con FEXGetCMP para Id ${ctx.fexId} N° ${ctx.numero} (${detalle})`)
    return autorizada(ctx, {
      cae: c.Cae,
      vencimientoYmd: c.Fch_venc_Cae,
      fechaCbte: c.Fecha_cbte,
      reproceso: false,
      recuperado: true,
      motivosObs: c.Motivos_Obs || null,
      response: c.raw,
    })
  }
  if (c) {
    return noAutorizada(
      ctx,
      'INCIERTA',
      [],
      `El N° ${formatNroComprobante(ctx.pv, ctx.numero)} ya existe en ARCA pero no coincide con lo enviado ` +
        `(Id ${c.Id}, total ${c.Imp_total}, fecha ${c.Fecha_cbte}): revisar a mano antes de emitir otra`,
      c.raw
    )
  }
  const errores =
    intento.tipo === 'respuesta' && intento.r.errores.length ? intento.r.errores : [{ Code: 0, Msg: detalle }]
  return noAutorizada(
    ctx,
    'INCIERTA',
    errores,
    `${huboCorte ? 'ARCA no respondió el primer envío' : 'Respuesta de ARCA sin resultado claro'} (${detalle}) ` +
      'y el comprobante todavía no figura. Queda INCIERTO: reconciliar con scripts/arca-fex-reconciliar.ts ' +
      '(reenvía el MISMO Id); no emitir otra',
    respuesta
  )
}

/**
 * Emite un comprobante de exportación con el ciclo idempotente de la
 * sección 7. Devuelve la autorización o el rechazo/incertidumbre (no lanza
 * ante un rechazo de ARCA). Lanza ExportacionValidacionError (datos),
 * ExportacionBloqueadaError (hay que reconciliar antes) o el error de la
 * reserva en la DB; en todos esos casos NO se llamó a FEXAuthorize.
 */
export async function emitirExportacion(
  input: ExportacionInput,
  persistencia: PersistenciaExportacion,
  opts: EmitirExportacionOpts = {}
): Promise<ExportacionResult> {
  const cliente = opts.cliente ?? clienteWsfex
  const ahora = opts.ahora ?? (() => new Date())
  const pv = resolverPuntoVenta(input)
  const entrada: ExportacionInput = { ...input, puntoVenta: pv }
  const cbteTipo = cbteTipoExportacion(entrada.clase ?? 'FACTURA')

  // Validación sin red: no consultar ARCA ni reservar con datos inválidos
  const previas = validarExportacion(entrada, { ahora: ahora() })
  if (previas.length) throw new ExportacionValidacionError(previas)

  return conLockWsfex(async () => {
    const bloqueante = await persistencia.buscarBloqueante(pv)
    if (bloqueante) {
      throw new ExportacionBloqueadaError(
        `Hay un comprobante de exportación ${bloqueante.estado} (Id ${bloqueante.fexId}, ` +
          `N° ${formatNroComprobante(pv, bloqueante.cbteNumero)}) sin resolver: reconciliarlo antes de emitir otro`
      )
    }

    const ultimo = await cliente.getLastCmp(cbteTipo, pv)
    if (persistencia.ultimoNumeroAutorizado) {
      const local = await persistencia.ultimoNumeroAutorizado(pv, cbteTipo)
      if (local !== ultimo) {
        throw new ExportacionBloqueadaError(
          `ARCA informa ${formatNroComprobante(pv, ultimo)} como último comprobante tipo ${cbteTipo} y el ERP ` +
            `tiene registrado hasta ${formatNroComprobante(pv, local)}: reconciliar antes de emitir`
        )
      }
    }
    const numero = ultimo + 1
    const ultimoIdArca = await cliente.getLastId()
    const ultimoIdDb = await persistencia.maxFexId()
    const fexId = Math.max(ultimoIdArca, ultimoIdDb) + 1

    const { cmp, totales } = buildFexRequest(entrada, numero, fexId, { ahora: ahora() })
    const cmpXml = buildFexAuthorizeBody(cmp)

    // Reserva ANTES de llamar: si esto falla, se propaga y ARCA no se entera
    await persistencia.reservar({ fexId, cbteTipo, puntoVenta: pv, cbteNumero: numero, cmp, cmpXml, totales, input: entrada })

    const ctx: Contexto = { fexId, cbteTipo, pv, numero, cmp, totales, persistencia }
    logger.info(
      `[WSFEX] Emitiendo ${numeroInternoExportacion(cbteTipo, pv, numero)} Id ${fexId} total USD ${cmp.Imp_total}`
    )

    let intento = await intentar(cliente, cmpXml)
    const huboCorte = intento.tipo === 'sin-respuesta'
    if (intento.tipo === 'sin-respuesta') {
      logger.warn(`[WSFEX] FEXAuthorize sin respuesta (Id ${fexId}): reintento con el MISMO Id`, intento.error.message)
      const espera = opts.esperaReintentoMs ?? 3000
      if (espera > 0) await new Promise((res) => setTimeout(res, espera))
      intento = await intentar(cliente, cmpXml)
    }

    if (intento.tipo === 'respuesta') {
      const r = intento.r
      if (r.Resultado === 'A' && r.Cae) {
        // Defensa: con un Id ya usado ARCA devolvería OTRO comprobante como reproceso
        if ((r.Id && r.Id !== fexId) || (r.Cbte_nro && r.Cbte_nro !== numero)) {
          return noAutorizada(
            ctx,
            'INCIERTA',
            [],
            `ARCA devolvió CAE para Id ${r.Id} N° ${r.Cbte_nro}, distinto de lo enviado (Id ${fexId}, N° ${numero}): revisar con FEXGetCMP`,
            r.raw
          )
        }
        return autorizada(ctx, {
          cae: r.Cae,
          vencimientoYmd: r.Fch_venc_Cae,
          fechaCbte: r.Fch_cbte,
          reproceso: r.Reproceso,
          recuperado: false,
          motivosObs: r.Motivos_Obs || null,
          eventos: r.eventos,
          response: r.raw,
        })
      }
      const transitorio = r.errores.some((e) => FEX_ERR_TRANSITORIOS.has(e.Code))
      // Tras un corte, un rechazo del reintento podría deberse a que el primer envío SÍ se
      // autorizó (número ya usado): se confirma con FEXGetCMP antes de darlo por rechazado
      if (!transitorio && !huboCorte && (r.Resultado === 'R' || r.errores.length)) {
        const errores = r.errores.length
          ? r.errores
          : [{ Code: 0, Msg: r.Motivos_Obs || 'ARCA rechazó el comprobante sin detalle' }]
        return noAutorizada(ctx, 'RECHAZADA', errores, formatFexErrores(errores), r.raw)
      }
    }
    // 'A' sin CAE, error interno de ARCA, SOAP Fault, sin respuesta o rechazo tras un corte: confirmar con FEXGetCMP
    return recuperar(cliente, ctx, intento, huboCorte)
  })
}

// ---------------------------------------------------------------------------
// Vista previa (dryRun)
// ---------------------------------------------------------------------------

export interface VistaPreviaExportacion {
  dryRun: true
  cbteTipo: number
  puntoVenta: number
  numero: number
  numeroFormateado: string
  numeroInterno: string
  fexId: number
  cmp: FexCmp
  /** Cuerpo <Cmp> exacto que se mandaría */
  cmpXml: string
  /** Sobre SOAP completo de FEXAuthorize, con Token y Sign ocultos */
  xml: string
  totales: TotalesExportacion
  /** No bloquean la vista previa pero sí la emisión */
  advertencias: string[]
}

/**
 * Arma el request EXACTO (número e Id reales según ARCA y la DB) sin llamar a
 * FEXAuthorize ni reservar nada. Solo hace lecturas (FEXGetLast_CMP/ID).
 */
export async function vistaPreviaExportacion(
  input: ExportacionInput,
  persistencia: Pick<PersistenciaExportacion, 'buscarBloqueante' | 'maxFexId'>,
  opts: { cliente?: Pick<FexCliente, 'getLastCmp' | 'getLastId'>; ahora?: () => Date; cuitEmisor?: string } = {}
): Promise<VistaPreviaExportacion> {
  const cliente = opts.cliente ?? clienteWsfex
  const ahora = opts.ahora ?? (() => new Date())
  const pv = resolverPuntoVenta(input)
  const entrada: ExportacionInput = { ...input, puntoVenta: pv }
  const cbteTipo = cbteTipoExportacion(entrada.clase ?? 'FACTURA')

  const previas = validarExportacion(entrada, { ahora: ahora() })
  if (previas.length) throw new ExportacionValidacionError(previas)

  const advertencias: string[] = []
  const bloqueante = await persistencia.buscarBloqueante(pv)
  if (bloqueante) {
    advertencias.push(
      `Hay un comprobante de exportación ${bloqueante.estado} (Id ${bloqueante.fexId}) sin resolver: no se va a poder emitir hasta reconciliarlo`
    )
  }
  const numero = (await cliente.getLastCmp(cbteTipo, pv)) + 1
  const fexId = Math.max(await cliente.getLastId(), await persistencia.maxFexId()) + 1
  const { cmp, totales } = buildFexRequest(entrada, numero, fexId, { ahora: ahora() })
  const cmpXml = buildFexAuthorizeBody(cmp)
  const cuit = opts.cuitEmisor ?? getArcaConfig().cuit
  const xml = buildFexEnvelope('FEXAuthorize', buildFexAuthXml({ token: '(oculto)', sign: '(oculto)', cuit }) + cmpXml)

  return {
    dryRun: true,
    cbteTipo,
    puntoVenta: pv,
    numero,
    numeroFormateado: formatNroComprobante(pv, numero),
    numeroInterno: numeroInternoExportacion(cbteTipo, pv, numero),
    fexId,
    cmp,
    cmpXml,
    xml,
    totales,
    advertencias,
  }
}

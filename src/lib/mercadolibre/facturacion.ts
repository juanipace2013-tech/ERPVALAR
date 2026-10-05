/**
 * Facturación de ventas de Mercado Libre desde el ERP.
 *
 * Circuito (mismo que las facturas de cotizaciones con FACTURACION_EMISOR=arca):
 *   orden ML → CAE en ARCA (PV 7) → alta en Colppy como Aprobada (CC, stock,
 *   asiento) → Invoice en el ERP → PDF subido al pack de ML.
 *
 * Dos pestañas (pedido de Santiago, 2026-10-05):
 *   - Factura A: Responsables Inscriptos y Monotributistas (RG 5003/2021,
 *     condición IVA 6).
 *   - Factura B: Consumidores Finales y Exentos. El cliente se da de alta en el
 *     ERP y en Colppy con su CUIT/CUIL (nunca un "Consumidor Final" genérico)
 *     para llevar bien la cuenta corriente.
 *
 * Datos fiscales del comprador: los da ML (billing-info, permiso "Facturación").
 * El listado clasifica con la condición que informa ML; la letra DEFINITIVA la
 * decide el padrón de ARCA al emitir (manda ARCA, no ML). Si la venta está en
 * la pestaña equivocada se rechaza con 409: nunca se emite la otra letra.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { sendQuoteToColppy } from '@/lib/colppy'
import { syncStockForSkusFireAndForget } from '@/lib/colppy-inventory'
import { normalizeCuit, buildCuitWhereClause, esCuitValido, cuilsCandidatosDesdeDni } from '@/lib/cuit-utils'
import { consultarPersona, PadronError, provincia as provinciaErp, type PersonaPadron } from '@/lib/arca/padron'
import { DOC_TIPO } from '@/lib/arca/wsfe'
import { describeCbteTipo } from '@/lib/arca/emitir'
import { crearHookEmisionArca, emisionDescartada, getEmisorFacturacion, type HookEmisionArca } from '@/lib/facturacion/emision-arca'
import { buildFacturaPdfData } from '@/lib/facturacion/factura-pdf-data'
import { totalesFacturaB } from '@/lib/facturacion/totales-factura'
import { generateFacturaPDF, facturaPdfFilename } from '@/lib/pdf/factura-generator'
import { archivarFacturaEnSharePointBg } from '@/lib/sharepoint/facturas-emitidas'
import { PESTANA_FACTURA_ML } from './facturacion-form'
import {
  MlApiError,
  getBuyerFiscal,
  getPack,
  getPackFiscalDocuments,
  getSaleOrder,
  searchPaidOrdersSince,
  uploadPackFiscalDocument,
  type MlBillingAddress,
  type MlBuyerFiscal,
  type MlSaleOrder,
} from './client'

export type ClaseFacturaMl = 'A' | 'B'

/** Nombre de cada pestaña (también para los mensajes de "va por la otra"); lo comparte la pantalla. */
export { PESTANA_FACTURA_ML }

const CORTE_DEFAULT = '2026-10-01T00:00:00-03:00'

/** Pestaña A: ventas anteriores a esta fecha ya se facturaron por Colppy (corte del PV 7). */
export function facturacionMlDesde(): Date {
  return new Date(process.env.ML_FACTURACION_DESDE || CORTE_DEFAULT)
}

/** Pestaña B (consumidores finales): por defecto el mismo corte que la A. */
export function facturacionMlCfDesde(): Date {
  return new Date(process.env.ML_FACTURACION_CF_DESDE || process.env.ML_FACTURACION_DESDE || CORTE_DEFAULT)
}

/** Corte de la pestaña de esa letra: A → facturacionMlDesde(), B → facturacionMlCfDesde(). */
export function corteFacturacionMl(clase: ClaseFacturaMl): Date {
  return clase === 'A' ? facturacionMlDesde() : facturacionMlCfDesde()
}

/**
 * Tope de órdenes que se traen de ML en el listado (las más nuevas primero,
 * páginas de 50). Alto a propósito: con un tope chico las ventas más viejas
 * sin facturar quedaban afuera. Las ventas ya facturadas no generan llamadas
 * extra a ML (ni billing-info ni fiscal_documents).
 */
function maxOrdenesListado(): number {
  const n = Number(process.env.ML_FACTURACION_MAX_ORDENES)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3000
}

export type CodigoErrorFacturaMl =
  | 'CLASE_INVALIDA' // la pestaña no es 'A' ni 'B'
  | 'CLASE_INCORRECTA' // ARCA dice que va por la otra pestaña (ver claseCorrecta)
  | 'FACTURA_EN_ML' // ML tiene (o no pudo descartar) una factura adjunta y no se confirmó
  | 'CUIT_REQUERIDO' // no hay CUIT/CUIL del comprador: ingresarlo en el borrador
  | 'CUIT_INVALIDO' // el CUIT/CUIL ingresado no es válido o ARCA no lo tiene
  | 'YA_FACTURADA' // candado: ya se facturó o se está facturando
  | 'ANTERIOR_AL_CORTE' // la venta es anterior al corte de su letra: va por Colppy
  | 'CONDICION_IVA_INCIERTA' // ARCA no da la condición IVA y tiene observaciones (errorConstancia)
  | 'CONDICION_DISTINTA_ERP' // el ERP lo tiene como RI/Monotributo y ARCA dice CF/Exento
  | 'ARCA_INCIERTO' // se pidió el CAE y ARCA no confirmó: candado puesto, revisar

export class FacturacionMlError extends Error {
  readonly codigo?: CodigoErrorFacturaMl
  readonly claseCorrecta?: ClaseFacturaMl
  /** FACTURA_EN_ML: true = ML tiene factura adjunta; null = ML no pudo confirmarlo */
  readonly facturaEnMl?: boolean | null
  constructor(
    message: string,
    readonly status = 422,
    extra: { codigo?: CodigoErrorFacturaMl; claseCorrecta?: ClaseFacturaMl; facturaEnMl?: boolean | null } = {}
  ) {
    super(message)
    this.codigo = extra.codigo
    this.claseCorrecta = extra.claseCorrecta
    if (extra.facturaEnMl !== undefined) this.facturaEnMl = extra.facturaEnMl
  }
}

/**
 * Fecha de la venta para los cortes: la más vieja de las órdenes del pack
 * (date_created, o date_closed si falta). Inválida si ML no dio fechas.
 */
export function fechaVentaMl(orders: Array<Pick<MlSaleOrder, 'date_created' | 'date_closed'>>): Date {
  const tiempos = orders
    .map((o) => new Date(o.date_created ?? o.date_closed ?? '').getTime())
    .filter((t) => Number.isFinite(t))
  return new Date(tiempos.length ? Math.min(...tiempos) : NaN)
}

const diaAr = (d: Date) => d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })

/**
 * Las ventas anteriores al corte de su letra ya se facturan por Colppy:
 * 409 ANTERIOR_AL_CORTE (antes de tomar el candado). Mismo criterio que el
 * listado, pero con la letra que decidió ARCA.
 */
export function verificarCorteMl(clase: ClaseFacturaMl, fechaVenta: Date): void {
  const corte = corteFacturacionMl(clase)
  if (fechaVenta.getTime() < corte.getTime()) {
    throw new FacturacionMlError(`Las ventas anteriores al ${diaAr(corte)} se facturan por Colppy`, 409, {
      codigo: 'ANTERIOR_AL_CORTE',
    })
  }
}

const packKeyDe = (o: MlSaleOrder) => String(o.pack_id ?? o.id)

const redondear = (n: number) => Math.round(n * 100) / 100

const totalDe = (orders: MlSaleOrder[]) => redondear(orders.reduce((s, o) => s + Number(o.total_amount ?? 0), 0))

/** Mapea concurrencia acotada (las llamadas a ML son de a una por venta). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx])
      }
    })
  )
  return out
}

// ---------------------------------------------------------------------------
// Clasificación y documento del comprador (según ML)
// ---------------------------------------------------------------------------

/**
 * Pestaña según la condición que informa ML (solo para el listado; al emitir
 * manda el padrón de ARCA). RI y Monotributo → A; Consumidor Final, Exento y
 * cualquier otra → B; null si ML no la informó.
 */
export function claseSegunMl(taxpayerType: string | null | undefined): ClaseFacturaMl | null {
  const t = (taxpayerType ?? '').trim()
  // Vacío o un id numérico (billing-info viejo) no dicen la condición
  if (!t || /^\d+$/.test(t)) return null
  if (/responsable\s+inscripto/i.test(t)) return 'A'
  if (/monotribut/i.test(t)) return 'A'
  return 'B'
}

/** Documento del comprador: CUIT/CUIL (11 dígitos, con guiones) o DNI (7-8 dígitos). */
export interface DocumentoComprador {
  tipo: 'CUIT' | 'DNI'
  numero: string
}

/** Normaliza el documento que informa ML (puede venir con puntos, guiones o mal tipado). */
export function documentoDeFiscal(f: Pick<MlBuyerFiscal, 'docType' | 'docNumber'> | null | undefined): DocumentoComprador | null {
  const digitos = (f?.docNumber ?? '').replace(/\D/g, '')
  if (digitos.length === 11) {
    // CUIT o CUIL; si ML lo tipó como otra cosa, solo si el dígito verificador cierra
    if (!f?.docType || /CUIT|CUIL/i.test(f.docType) || esCuitValido(digitos)) {
      return { tipo: 'CUIT', numero: normalizeCuit(digitos)! }
    }
    return null
  }
  if (digitos.length >= 7 && digitos.length <= 8) return { tipo: 'DNI', numero: String(Number(digitos)) }
  return null
}

function cuitDeFiscal(f: MlBuyerFiscal | null): string | null {
  const d = documentoDeFiscal(f)
  return d?.tipo === 'CUIT' ? d.numero : null
}

/** Domicilio del comprador con los nombres de provincia del ERP. */
export interface DomicilioComprador {
  direccion: string | null
  localidad: string | null
  provincia: string | null
  codigoPostal: string | null
}

const textoLimpio = (v: unknown, max = 200): string | null => {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim() : ''
  return s ? s.slice(0, max) : null
}

function domicilioValido(d: DomicilioComprador): DomicilioComprador | null {
  return d.direccion || d.localidad || d.provincia || d.codigoPostal ? d : null
}

export function domicilioDesdeMl(a: MlBillingAddress | null | undefined): DomicilioComprador | null {
  if (!a) return null
  return domicilioValido({
    direccion: textoLimpio([a.calle, a.numero].filter(Boolean).join(' ')),
    localidad: textoLimpio(a.ciudad, 40),
    provincia: a.provincia ? provinciaErp(a.provincia) || null : null,
    codigoPostal: textoLimpio(a.cp, 10),
  })
}

function domicilioDesdePadron(p: PersonaPadron): DomicilioComprador | null {
  return domicilioValido({
    direccion: textoLimpio(p.domicilio.direccion),
    localidad: textoLimpio(p.domicilio.localidad, 40),
    provincia: textoLimpio(p.domicilio.provincia),
    codigoPostal: textoLimpio(p.domicilio.codigoPostal, 10),
  })
}

/** Domicilio editado en el borrador (entrada del usuario: se sanea). */
function domicilioDesdeBorrador(d: Partial<DomicilioComprador> | null | undefined): DomicilioComprador | null {
  if (!d || typeof d !== 'object') return null
  return domicilioValido({
    direccion: textoLimpio(d.direccion),
    localidad: textoLimpio(d.localidad, 40),
    provincia: d.provincia ? provinciaErp(String(d.provincia)) || null : null,
    codigoPostal: textoLimpio(d.codigoPostal, 10),
  })
}

// ---------------------------------------------------------------------------
// Caché de las llamadas a ML del listado (pm2 corre un solo proceso)
// ---------------------------------------------------------------------------

const HORA_MS = 3600 * 1000
const TTL_FISCAL = 24 * HORA_MS // los datos fiscales de una compra no cambian
const TTL_FACTURA_EN_ML_SI = 24 * HORA_MS
const TTL_FACTURA_EN_ML_NO = 3 * 60 * 1000

type EntradaCache<T> = { valor: T; vence: number }
const cacheFiscal = new Map<string, EntradaCache<MlBuyerFiscal>>()
const cacheFacturaEnMl = new Map<string, EntradaCache<boolean>>()

function leerCache<T>(m: Map<string, EntradaCache<T>>, clave: string): T | undefined {
  const e = m.get(clave)
  if (!e) return undefined
  if (e.vence < Date.now()) {
    m.delete(clave)
    return undefined
  }
  return e.valor
}

function guardarCache<T>(m: Map<string, EntradaCache<T>>, clave: string, valor: T, ttl: number) {
  if (m.size > 5000) {
    const ahora = Date.now()
    for (const [k, e] of m) if (e.vence < ahora) m.delete(k)
  }
  m.set(clave, { valor, vence: Date.now() + ttl })
}

/** Vacía los cachés de ML (tests). */
export function limpiarCachesFacturacionMl() {
  cacheFiscal.clear()
  cacheFacturaEnMl.clear()
}

/** getBuyerFiscal con caché (24 h). Lanza MlApiError como getBuyerFiscal. */
async function fiscalDelComprador(order: MlSaleOrder): Promise<MlBuyerFiscal> {
  const billingId = order.buyer?.billing_info?.id
  const clave = billingId ? `b:${billingId}` : `o:${order.id}`
  const enCache = leerCache(cacheFiscal, clave)
  if (enCache) return enCache
  const f = await getBuyerFiscal(order)
  guardarCache(cacheFiscal, clave, f, TTL_FISCAL)
  return f
}

/**
 * ¿La venta ya tiene una factura adjunta en ML (p. ej. emitida por Colppy)?
 * null = no se pudo verificar. `fresco` saltea el caché (al emitir).
 */
async function facturaAdjuntaEnMl(packId: string, opts: { fresco?: boolean } = {}): Promise<boolean | null> {
  if (!opts.fresco) {
    const enCache = leerCache(cacheFacturaEnMl, packId)
    if (enCache !== undefined) return enCache
  }
  try {
    const hay = (await getPackFiscalDocuments(packId)).length > 0
    guardarCache(cacheFacturaEnMl, packId, hay, hay ? TTL_FACTURA_EN_ML_SI : TTL_FACTURA_EN_ML_NO)
    return hay
  } catch (e) {
    // ML responde 404 cuando el pack no tiene documentos
    if (e instanceof MlApiError && e.status === 404) {
      guardarCache(cacheFacturaEnMl, packId, false, TTL_FACTURA_EN_ML_NO)
      return false
    }
    logger.warn(`[ML Facturación] No se pudo consultar las facturas del pack ${packId} en ML: ${(e as Error).message}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// Posible duplicado: ¿ya hay una factura del ERP a ese CUIT por el mismo total?
// ---------------------------------------------------------------------------

export interface PosibleDuplicado {
  invoiceId: string
  invoiceNumber: string
  issueDate: string
  total: number
}

const DIA_MS = 24 * HORA_MS
const VENTANA_DUPLICADO_MS = 5 * DIA_MS

/**
 * Facturas de venta del ERP (no anuladas, en pesos, no vinculadas a otra venta
 * de ML) al mismo CUIT, por el mismo total (±1 peso) y emitidas hasta 5 días
 * antes o después de la venta: pudo haberse facturado a mano. Solo avisa.
 * Una sola consulta para todas las ventas.
 */
export async function buscarPosiblesDuplicados(
  consultas: Array<{ clave: string; cuit: string; total: number; fecha: Date }>
): Promise<Map<string, PosibleDuplicado>> {
  const out = new Map<string, PosibleDuplicado>()
  const validas = consultas.filter((c) => c.cuit.replace(/\D/g, '').length === 11 && Number.isFinite(c.fecha.getTime()))
  if (!validas.length) return out

  const cuits = Array.from(new Set(validas.flatMap((c) => buildCuitWhereClause(c.cuit).OR.map((w) => w.cuit))))
  const tiempos = validas.map((c) => c.fecha.getTime())
  const facturas = await prisma.invoice.findMany({
    where: {
      transactionType: 'SALE',
      currency: 'ARS',
      status: { not: 'CANCELLED' },
      customer: { cuit: { in: cuits } },
      mlOrderInvoice: { is: null },
      issueDate: {
        gte: new Date(Math.min(...tiempos) - VENTANA_DUPLICADO_MS),
        lte: new Date(Math.max(...tiempos) + VENTANA_DUPLICADO_MS),
      },
    },
    select: { id: true, invoiceNumber: true, issueDate: true, total: true, customer: { select: { cuit: true } } },
  })

  for (const c of validas) {
    const digitos = c.cuit.replace(/\D/g, '')
    const t = c.fecha.getTime()
    const candidatas = facturas
      .filter(
        (f) =>
          f.customer.cuit.replace(/\D/g, '') === digitos &&
          Math.abs(Number(f.total) - c.total) <= 1 &&
          Math.abs(f.issueDate.getTime() - t) <= VENTANA_DUPLICADO_MS
      )
      .sort((a, b) => Math.abs(a.issueDate.getTime() - t) - Math.abs(b.issueDate.getTime() - t))
    const f = candidatas[0]
    if (f) out.set(c.clave, { invoiceId: f.id, invoiceNumber: f.invoiceNumber, issueDate: f.issueDate.toISOString(), total: Number(f.total) })
  }
  return out
}

// ---------------------------------------------------------------------------
// Listado (las dos pestañas en una sola respuesta: se filtra en el cliente)
// ---------------------------------------------------------------------------

export interface VentaMlItem {
  mlItemId: string
  title: string
  quantity: number
  unitPrice: number // final, con IVA
  productId: string | null // producto del ERP si la publicación está vinculada
  sku: string | null
  productName: string | null
}

export interface VentaMl {
  packId: string
  orderIds: string[]
  fecha: string
  buyerNickname: string | null
  total: number
  items: VentaMlItem[]
  /** null = ML no entregó los datos fiscales (falta el permiso o error) */
  fiscal: MlBuyerFiscal | null
  fiscalError: string | null
  /** CUIT/CUIL: el que informó ML o, si ya se facturó, el facturado. null si ML dio DNI o nada */
  cuit: string | null
  /** Documento tal como lo informó ML (CUIT/CUIL o DNI) */
  documentoMl: DocumentoComprador | null
  /**
   * Pestaña: 'A' (RI / Monotributo) o 'B' (Consumidor Final / Exento / otros).
   * null = candado sin factura (EMITIENDO): revisar, mostrar en las dos.
   */
  clase: ClaseFacturaMl | null
  /**
   * De dónde sale la pestaña: 'factura' (la letra emitida), 'ml' (condición que
   * informó ML), 'sin-dato' (ML no la informó: va a la B y se verifica con ARCA
   * al emitir), 'candado' (clase null).
   */
  claseOrigen: 'factura' | 'ml' | 'sin-dato' | 'candado'
  /**
   * Ya tiene una factura adjunta en ML (p. ej. emitida por Colppy). null = ML
   * no lo pudo confirmar: al emitir hay que confirmarlo en el borrador.
   */
  facturaEnMl: boolean | null
  /** Factura del ERP al mismo CUIT y total cerca de la fecha (solo pendientes con CUIT) */
  posibleDuplicado: PosibleDuplicado | null
  /** Facturada desde el ERP */
  facturada: null | {
    invoiceId: string | null
    invoiceNumber: string | null
    status: string
    mlUploadStatus: string | null
    mlUploadError: string | null
    colppySyncStatus: string | null
  }
}

export interface ConteoPestanaMl {
  /** Sin facturar y sin factura en ML */
  pendientes: number
  total: number
}

export interface ListadoVentasMl {
  /** Corte de la pestaña A (compatibilidad) */
  desde: string
  desdeA: string
  desdeB: string
  ventas: VentaMl[]
  /** true si ML respondió 403 a billing-info: hay que habilitar el permiso */
  sinPermisoFiscal: boolean
  conteos: { A: ConteoPestanaMl; B: ConteoPestanaMl; revisar: number }
  /**
   * ML tiene más ventas pagas desde el corte que las que se trajeron (tope
   * ML_FACTURACION_MAX_ORDENES) o una página del listado de ML falló
   */
  truncado: boolean
  /** Aviso para la pantalla si ML no devolvió todas las páginas (null si estuvo todo) */
  avisoListado: string | null
}

export const AVISO_LISTADO_INCOMPLETO = 'Mercado Libre no devolvió todas las ventas (reintentá en un rato)'

export async function listarVentasMl(): Promise<ListadoVentasMl> {
  const desdeA = facturacionMlDesde()
  const desdeB = facturacionMlCfDesde()
  const desde = new Date(Math.min(desdeA.getTime(), desdeB.getTime()))
  // Si falla la primera página de ML lanza (500); si falla una posterior, sigue
  // con las ya traídas y paging.error avisa que el listado está incompleto
  const paging: { total?: number; error?: string } = {}
  const orders = await searchPaidOrdersSince(desde, maxOrdenesListado(), paging)

  // Agrupar por pack (un carrito con varios productos = varias órdenes, una factura)
  const grupos = new Map<string, MlSaleOrder[]>()
  for (const o of orders) {
    const k = packKeyDe(o)
    grupos.set(k, [...(grupos.get(k) ?? []), o])
  }
  const keys = Array.from(grupos.keys())

  const itemIds = Array.from(new Set(orders.flatMap((o) => o.order_items.map((i) => i.item.id))))
  const [registros, links] = await Promise.all([
    prisma.mlOrderInvoice.findMany({
      where: { packId: { in: keys } },
      include: { invoice: { select: { id: true, invoiceNumber: true, invoiceType: true, colppySyncStatus: true } } },
    }),
    prisma.mlItemLink.findMany({
      where: { mlItemId: { in: itemIds }, status: 'LINKED', productId: { not: null } },
      select: { mlItemId: true, product: { select: { id: true, sku: true, name: true } } },
    }),
  ])
  const regPorPack = new Map(registros.map((r) => [r.packId, r]))
  const linkPorItem = new Map(links.map((l) => [l.mlItemId, l.product]))

  let sinPermisoFiscal = false

  const ventas = await mapLimit(keys, 4, async (packId): Promise<VentaMl | null> => {
    const ords = grupos.get(packId)!
    const reg = regPorPack.get(packId)
    const first = ords[0]

    let fiscal: MlBuyerFiscal | null = null
    let fiscalError: string | null = null
    let facturaEnMl: boolean | null = false
    let clase: ClaseFacturaMl | null
    let claseOrigen: VentaMl['claseOrigen']

    if (!reg) {
      try {
        fiscal = await fiscalDelComprador(first)
      } catch (e) {
        if (e instanceof MlApiError && e.status === 403) {
          sinPermisoFiscal = true
          fiscalError = 'ML no habilitó los datos fiscales (permiso "Facturación")'
        } else {
          fiscalError = (e as Error).message
        }
      }
      const segunMl = claseSegunMl(fiscal?.taxpayerType)
      clase = segunMl ?? 'B'
      claseOrigen = segunMl ? 'ml' : 'sin-dato'

      // Corte de cada pestaña (antes de pedirle más cosas a ML); misma fecha
      // que se controla al emitir (fechaVentaMl)
      if (fechaVentaMl(ords).getTime() < (clase === 'A' ? desdeA : desdeB).getTime()) return null

      // null = ML no lo pudo confirmar (se muestra y el borrador pide confirmarlo)
      facturaEnMl = await facturaAdjuntaEnMl(packId)
    } else if (reg.invoice) {
      clase = reg.invoice.invoiceType === 'A' ? 'A' : 'B'
      claseOrigen = 'factura'
    } else {
      clase = null
      claseOrigen = 'candado'
    }

    return {
      packId,
      orderIds: ords.map((o) => String(o.id)),
      fecha: first.date_closed ?? first.date_created ?? '',
      buyerNickname: first.buyer?.nickname ?? null,
      total: totalDe(ords),
      items: ords.flatMap((o) =>
        o.order_items.map((it) => {
          const p = linkPorItem.get(it.item.id)
          return {
            mlItemId: it.item.id,
            title: it.item.title ?? it.item.id,
            quantity: it.quantity,
            unitPrice: Number(it.unit_price),
            productId: p?.id ?? null,
            sku: p?.sku ?? null,
            productName: p?.name ?? null,
          }
        })
      ),
      fiscal,
      fiscalError,
      cuit: reg?.cuit ?? cuitDeFiscal(fiscal),
      documentoMl: documentoDeFiscal(fiscal),
      clase,
      claseOrigen,
      facturaEnMl,
      posibleDuplicado: null,
      facturada: reg
        ? {
            invoiceId: reg.invoice?.id ?? null,
            invoiceNumber: reg.invoice?.invoiceNumber ?? null,
            status: reg.status,
            mlUploadStatus: reg.mlUploadStatus,
            mlUploadError: reg.mlUploadError,
            colppySyncStatus: reg.invoice?.colppySyncStatus ?? null,
          }
        : null,
    }
  })
  const lista = ventas.filter((v): v is VentaMl => v !== null)

  // Aviso de posible factura hecha a mano (pendientes con CUIT conocido)
  const pendientesConCuit = lista.filter((v) => !v.facturada && v.cuit)
  if (pendientesConCuit.length) {
    try {
      const dups = await buscarPosiblesDuplicados(
        pendientesConCuit.map((v) => ({ clave: v.packId, cuit: v.cuit!, total: v.total, fecha: new Date(v.fecha) }))
      )
      for (const v of pendientesConCuit) v.posibleDuplicado = dups.get(v.packId) ?? null
    } catch (e) {
      logger.warn(`[ML Facturación] No se pudo buscar facturas duplicadas: ${(e as Error).message}`)
    }
  }

  const conteo = (c: ClaseFacturaMl): ConteoPestanaMl => {
    const deLaClase = lista.filter((v) => v.clase === c)
    return { total: deLaClase.length, pendientes: deLaClase.filter((v) => !v.facturada && !v.facturaEnMl).length }
  }

  return {
    desde: desdeA.toISOString(),
    desdeA: desdeA.toISOString(),
    desdeB: desdeB.toISOString(),
    ventas: lista,
    sinPermisoFiscal,
    conteos: { A: conteo('A'), B: conteo('B'), revisar: lista.filter((v) => v.clase === null).length },
    truncado: (paging.total ?? 0) > orders.length || !!paging.error,
    avisoListado: paging.error ? AVISO_LISTADO_INCOMPLETO : null,
  }
}

// ---------------------------------------------------------------------------
// Comprador: CUIT/CUIL, padrón de ARCA y letra que corresponde
// ---------------------------------------------------------------------------

export type EstadoPadronComprador = 'encontrado' | 'no-existe'

export type ConsultaPadronComprador =
  | { estado: 'encontrado'; persona: PersonaPadron }
  | { estado: 'no-existe'; mensaje: string }

/**
 * Padrón A5 para el comprador. Verificado contra ARCA (prod, 5/10/2026):
 *  - un CUIL puro NO es un error: vuelve datosGenerales con tipoClave "CUIL";
 *  - una clave inexistente es un SOAP Fault "No existe persona con ese Id"
 *    (PadronError.noExiste): 'no-existe'.
 * Cualquier otro error (otros 404 como clave inválida o errorConstancia sin
 * datos generales, ARCA caído, certificado, ...) se propaga: no se emite.
 */
export async function consultarPadronComprador(cuit: string): Promise<ConsultaPadronComprador> {
  try {
    return { estado: 'encontrado', persona: await consultarPersona(cuit) }
  } catch (e) {
    if (e instanceof PadronError && e.noExiste) return { estado: 'no-existe', mensaje: e.message }
    throw e
  }
}

/** Mensaje para un error del padrón que no es "no existe" (502 al emitir, motivo en el borrador). */
function mensajeErrorPadron(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return e instanceof PadronError ? `ARCA (padrón): ${msg}` : `No se pudo consultar el padrón de ARCA: ${msg}`
}

export interface CandidatoCuil {
  cuit: string
  resultado: EstadoPadronComprador | 'error' | 'sin-consultar'
  detalle?: string
  /** Nombre según ARCA (solo si lo encontró) */
  nombreArca?: string | null
}

/** Partículas que no cuentan al comparar nombres ("DE LA FUENTE" → FUENTE) */
const PARTICULAS_NOMBRE = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E', 'DA', 'DI', 'DO', 'DOS', 'DAS', 'VON', 'VAN'])

/** Palabras de un nombre sin acentos ni mayúsculas/minúsculas, sin iniciales ni partículas. */
export function palabrasNombre(s: string | null | undefined): string[] {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 2 && !PARTICULAS_NOMBRE.has(w))
}

/**
 * ¿El nombre de facturación de ML es el de esta persona de ARCA? Coincide el
 * apellido (alguna palabra del apellido; si ARCA no lo separa, la primera
 * palabra de "APELLIDO NOMBRE") o al menos dos palabras en común.
 */
export function nombreCoincideConMl(nombreMl: string | null | undefined, persona: { razonSocial: string; apellido?: string | null }): boolean {
  const ml = new Set(palabrasNombre(nombreMl))
  if (!ml.size) return false
  const arca = palabrasNombre(persona.razonSocial)
  const apellido = persona.apellido ? palabrasNombre(persona.apellido) : arca.slice(0, 1)
  if (apellido.some((w) => ml.has(w))) return true
  return new Set(arca.filter((w) => ml.has(w))).size >= 2
}

/**
 * Entre varios CUIL del mismo DNI que ARCA conoce, el del comprador según el
 * nombre de ML: solo si coincide UNO (ninguno o varios → null: lo elige una
 * persona en el borrador; nunca se adivina).
 */
export function elegirCuilPorNombre<T extends { persona: { razonSocial: string; apellido?: string | null } }>(
  nombreMl: string | null | undefined,
  encontrados: T[]
): T | null {
  const coinciden = encontrados.filter((e) => nombreCoincideConMl(nombreMl, e.persona))
  return coinciden.length === 1 ? coinciden[0] : null
}

/**
 * CUIL de un comprador del que ML solo da el DNI: consulta en el padrón TODOS
 * los CUIL posibles (20, 27, 23, 24; los de dígito verificador 10 ni se
 * arman), de a uno. Con uno solo en ARCA se usa ese; con más de uno (DNI
 * repetidos), el que coincide con el nombre de facturación de ML; si ninguno
 * o varios coinciden, `ambiguo` y los encontrados quedan como opciones para
 * elegir en el borrador. Solo "No existe persona con ese Id" pasa al
 * siguiente: cualquier otro error de ARCA corta la búsqueda y se informa (no se
 * saltea en silencio ni se sigue martillando el servicio).
 */
export async function resolverCuilDesdeDni(
  dni: string,
  nombreMl?: string | null
): Promise<{
  cuit: string | null
  consulta: ConsultaPadronComprador | null
  candidatos: CandidatoCuil[]
  error: string | null
  /** Más de un CUIL del DNI en ARCA y el nombre de ML no permite elegir */
  ambiguo: boolean
}> {
  const candidatos: CandidatoCuil[] = cuilsCandidatosDesdeDni(dni).map((c) => ({ cuit: normalizeCuit(c)!, resultado: 'sin-consultar' }))
  const encontrados: Array<{ cuit: string; consulta: ConsultaPadronComprador; persona: PersonaPadron }> = []
  for (const c of candidatos) {
    try {
      const consulta = await consultarPadronComprador(c.cuit)
      c.resultado = consulta.estado
      if (consulta.estado === 'encontrado') {
        c.nombreArca = consulta.persona.razonSocial || null
        encontrados.push({ cuit: c.cuit, consulta, persona: consulta.persona })
      }
    } catch (e) {
      c.resultado = 'error'
      c.detalle = mensajeErrorPadron(e)
      return { cuit: null, consulta: null, candidatos, error: c.detalle, ambiguo: false }
    }
  }
  const elegido = encontrados.length === 1 ? encontrados[0] : elegirCuilPorNombre(nombreMl, encontrados)
  if (elegido) return { cuit: elegido.cuit, consulta: elegido.consulta, candidatos, error: null, ambiguo: false }
  return { cuit: null, consulta: null, candidatos, error: null, ambiguo: encontrados.length > 1 }
}

/** "20-12345678-6 (PEREZ JUAN), 27-12345678-0 (PEREZ ANA)": CUIL del DNI que ARCA conoce */
function cuilsEncontradosTexto(candidatos: CandidatoCuil[]): string {
  return candidatos
    .filter((c) => c.resultado === 'encontrado')
    .map((c) => (c.nombreArca ? `${c.cuit} (${c.nombreArca})` : c.cuit))
    .join(', ')
}

export type TaxConditionMl = 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO' | 'CONSUMIDOR_FINAL'

/** Lo que se emite para un comprador según ARCA (emisor RI). */
export interface DecisionFiscalMl {
  clase: ClaseFacturaMl
  /** Condición del cliente en el ERP / Colppy */
  taxCondition: TaxConditionMl
  /** Documento del receptor que va a ARCA: 80 CUIT, 86 CUIL, 87 CDI, 96 DNI */
  docTipo: number
  docNro: string
}

/** Prefijos de CUIT/CUIL de personas humanas (el DNI son los 8 dígitos del medio) */
const PREFIJOS_PERSONA = ['20', '23', '24', '27']

/** DocTipo de la B según el tipo de clave de ARCA: CUIL → 86, CDI → 87, CUIT (o sin dato) → 80 */
function docTipoSegunClave(tipoClave: string | null | undefined): number {
  const t = (tipoClave ?? '').trim().toUpperCase()
  if (t === 'CUIL') return DOC_TIPO.CUIL
  if (t === 'CDI') return DOC_TIPO.CDI
  return DOC_TIPO.CUIT
}

/**
 * Letra, condición y documento del receptor según el padrón (manda ARCA):
 *  - RI → A (cond. 1); Monotributo → A (cond. 6, RG 5003/2021). Requieren CUIT activo.
 *  - Exento → B (cond. 4).
 *  - Sin condición IVA y SIN observaciones de ARCA → B consumidor final
 *    (cond. 5), persona humana o jurídica (consorcios, asociaciones), con
 *    DocTipo 80 (CUIT), 86 si ARCA dice que la clave es un CUIL u 87 si es un CDI.
 *  - Sin condición IVA CON observaciones (errorConstancia) → error 422 si la
 *    clave es un CUIT: ARCA no puede confirmar la condición (podría ser RI con
 *    la constancia trabada). Un CUIL o un CDI no pueden ser RI ni
 *    monotributistas (para eso hace falta un CUIT): consumidor final igual.
 *  - ARCA no lo tiene ("No existe persona") → B consumidor final identificado
 *    con el DNI (96): WSFE valida 80/86/87 contra el padrón (error 10015) y el
 *    DNI no.
 *  - Persona con la clave inactiva (rechazo 10247) → B con el DNI.
 * Lanza FacturacionMlError si no se puede emitir a ese número.
 */
export function decidirFacturaMl(cuit: string, padron: ConsultaPadronComprador): DecisionFiscalMl {
  const digitos = cuit.replace(/\D/g, '')
  const formateado = normalizeCuit(digitos) ?? cuit
  const esPersona = PREFIJOS_PERSONA.includes(digitos.slice(0, 2))
  const conDni = (taxCondition: TaxConditionMl): DecisionFiscalMl => ({
    clase: 'B',
    taxCondition,
    docTipo: DOC_TIPO.DNI,
    docNro: String(Number(digitos.slice(2, 10))),
  })

  if (padron.estado === 'encontrado') {
    const p = padron.persona
    if (p.condicionIva === 'RESPONSABLE_INSCRIPTO' || p.condicionIva === 'MONOTRIBUTO') {
      if (!p.activo) throw new FacturacionMlError(`El CUIT ${formateado} figura inactivo en ARCA`)
      return { clase: 'A', taxCondition: p.condicionIva, docTipo: DOC_TIPO.CUIT, docNro: digitos }
    }
    // Sin condición IVA: es consumidor final SOLO si ARCA no dejó observaciones
    // (con errorConstancia la condición de un CUIT puede ser cualquiera: no se
    // adivina). Un CUIL o un CDI puro nunca es RI ni monotributista.
    const docTipo = docTipoSegunClave(p.tipoClave)
    const observaciones = (p.observaciones ?? []).map((o) => String(o).trim()).filter(Boolean)
    if (p.condicionIva === null && observaciones.length && docTipo === DOC_TIPO.CUIT) {
      throw new FacturacionMlError(
        `ARCA no puede confirmar la condición frente al IVA: ${observaciones.join(' · ')} (${formateado}). Verificá la constancia antes de facturar.`,
        422,
        { codigo: 'CONDICION_IVA_INCIERTA' }
      )
    }
    const taxCondition: TaxConditionMl = p.condicionIva === 'EXENTO' ? 'EXENTO' : 'CONSUMIDOR_FINAL'
    if (!p.activo) {
      if (p.tipoPersona === 'FISICA' && esPersona) return conDni(taxCondition)
      throw new FacturacionMlError(`El CUIT ${formateado} figura inactivo en ARCA`)
    }
    return { clase: 'B', taxCondition, docTipo, docNro: digitos }
  }
  if (!esPersona) {
    throw new FacturacionMlError(`ARCA no tiene registrado el CUIT ${formateado}: revisalo`, 422, { codigo: 'CUIT_INVALIDO' })
  }
  return conDni('CONSUMIDOR_FINAL')
}

const ETIQUETA_CONDICION: Record<TaxConditionMl, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
  MONOTRIBUTO: 'Monotributista',
  EXENTO: 'Exento',
  CONSUMIDOR_FINAL: 'Consumidor Final',
}

/** Condiciones de la Factura A: un cliente del ERP con alguna de estas nunca se baja solo a CF/Exento. */
const CONDICIONES_FACTURA_A: string[] = ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO']

/**
 * Cliente ya existente en el ERP como Responsable Inscripto o Monotributista y
 * ARCA lo da como Consumidor Final / Exento: NO se lo baja automáticamente (la
 * constancia pudo venir incompleta y la B sería la letra equivocada). 422 antes
 * del candado y de ARCA; lo resuelve una persona corrigiendo el cliente. Los
 * cambios hacia arriba (CF → RI/Monotributo según ARCA) siguen permitidos.
 */
export function verificarCondicionClienteErp(
  cliente: { name: string; taxCondition: string | null } | null,
  cuit: string,
  decision: Pick<DecisionFiscalMl, 'taxCondition'>
): void {
  const actual = cliente?.taxCondition ?? ''
  if (!cliente || !CONDICIONES_FACTURA_A.includes(actual) || CONDICIONES_FACTURA_A.includes(decision.taxCondition)) return
  throw new FacturacionMlError(
    `El ERP tiene a ${cliente.name} (${cuit}) como ${ETIQUETA_CONDICION[actual as TaxConditionMl]} y ARCA lo informa como ${ETIQUETA_CONDICION[decision.taxCondition]}: la condición no se cambia sola. Revisá la constancia en ARCA y corregí el cliente en el ERP antes de facturar.`,
    422,
    { codigo: 'CONDICION_DISTINTA_ERP' }
  )
}

function errorClaseIncorrecta(cuit: string, padron: ConsultaPadronComprador, decision: DecisionFiscalMl): FacturacionMlError {
  const quien = padron.estado === 'encontrado' ? `${padron.persona.razonSocial} (${cuit})` : cuit
  const situacion =
    decision.clase === 'A'
      ? `figura en ARCA como ${ETIQUETA_CONDICION[decision.taxCondition]}`
      : padron.estado === 'encontrado'
        ? `no es Responsable Inscripto ni Monotributista en ARCA (${ETIQUETA_CONDICION[decision.taxCondition]})`
        : 'no está inscripto en ARCA (consumidor final)'
  return new FacturacionMlError(
    `${quien} ${situacion}: va por Factura ${decision.clase}. Facturalo desde la pestaña "${PESTANA_FACTURA_ML[decision.clase]}".`,
    409,
    { codigo: 'CLASE_INCORRECTA', claseCorrecta: decision.clase }
  )
}

export interface CompradorMl {
  packId: string
  total: number
  fecha: string
  buyerNickname: string | null
  /** CUIT/CUIL a usar (NN-NNNNNNNN-N); null = hay que ingresarlo a mano */
  cuit: string | null
  /**
   * 'ml' (lo informó ML), 'padron' (derivado del DNI y confirmado en ARCA),
   * 'manual' (el que mandó el usuario en ?cuit=), 'manual-requerido' (falta: ver motivo)
   */
  origen: 'ml' | 'padron' | 'manual' | 'manual-requerido'
  documentoMl: DocumentoComprador | null
  nombreMl: string | null
  condicionMl: string | null
  domicilioMl: DomicilioComprador | null
  fiscalError: string | null
  /**
   * CUIL probados a partir del DNI (si ML solo dio el DNI). Con origen
   * 'manual-requerido', los 'encontrado' son las opciones para elegir.
   */
  candidatos: CandidatoCuil[]
  /** Resultado del padrón para el CUIT/CUIL (null si no hay CUIT o ARCA falló) */
  padron: EstadoPadronComprador | null
  razonSocial: string | null
  activo: boolean | null
  domicilioPadron: DomicilioComprador | null
  /** Lo que se emitiría (null si no se puede determinar: ver motivo) */
  clase: ClaseFacturaMl | null
  condicionIva: TaxConditionMl | null
  receptor: { docTipo: number; docNro: string } | null
  /** Sugeridos para el borrador: ARCA si lo tiene, si no ML */
  nombreSugerido: string | null
  domicilioSugerido: DomicilioComprador | null
  /** Por qué falta el CUIT/CUIL o por qué no se puede emitir */
  motivo: string | null
  facturaEnMl: boolean | null
  posibleDuplicado: PosibleDuplicado | null
  /**
   * La venta ya tiene el candado del ERP (facturada, o en emisión / para
   * revisar): no se arma nada (= 409 YA_FACTURADA del POST). null si no.
   */
  yaFacturada: null | { invoiceId: string | null; invoiceNumber: string | null; status: string }
}

/** Motivo del borrador para una venta que ya tiene el candado del ERP. */
function motivoYaFacturada(y: NonNullable<CompradorMl['yaFacturada']>): string {
  return y.invoiceNumber
    ? `Esta venta ya fue facturada desde el ERP (${y.invoiceNumber}).`
    : 'Esta venta se está facturando o quedó con la emisión sin terminar (para revisar): no se puede volver a facturar desde acá.'
}

/**
 * Datos del comprador para el borrador: CUIT/CUIL (de ML, derivado del DNI o el
 * ingresado), padrón de ARCA y la letra que corresponde. No emite nada.
 */
export async function resolverCompradorMl(packId: string, cuitManual?: string | null): Promise<CompradorMl> {
  // Candado del ERP (= 409 YA_FACTURADA del POST): el borrador no ofrece emitir
  // (ni "Emitir igual") para una venta que el ERP ya facturó o está facturando
  const reg = await prisma.mlOrderInvoice.findUnique({
    where: { packId },
    include: { invoice: { select: { id: true, invoiceNumber: true } } },
  })
  if (reg) {
    const yaFacturada = { invoiceId: reg.invoiceId ?? reg.invoice?.id ?? null, invoiceNumber: reg.invoice?.invoiceNumber ?? null, status: reg.status }
    return {
      packId,
      total: Number(reg.total ?? 0),
      fecha: reg.createdAt ? new Date(reg.createdAt).toISOString() : '',
      buyerNickname: reg.buyerNickname ?? null,
      cuit: null,
      origen: 'manual-requerido',
      documentoMl: null,
      nombreMl: null,
      condicionMl: null,
      domicilioMl: null,
      fiscalError: null,
      candidatos: [],
      padron: null,
      razonSocial: null,
      activo: null,
      domicilioPadron: null,
      clase: null,
      condicionIva: null,
      receptor: null,
      nombreSugerido: null,
      domicilioSugerido: null,
      motivo: motivoYaFacturada(yaFacturada),
      facturaEnMl: null,
      posibleDuplicado: null,
      yaFacturada,
    }
  }

  const orders = await ordenesDelPack(packId)
  const first = orders[0]

  let fiscal: MlBuyerFiscal | null = null
  let fiscalError: string | null = null
  try {
    fiscal = await fiscalDelComprador(first)
  } catch (e) {
    fiscalError =
      e instanceof MlApiError && e.status === 403
        ? 'ML no habilitó los datos fiscales (permiso "Facturación")'
        : (e as Error).message
  }
  const documentoMl = documentoDeFiscal(fiscal)
  const domicilioMl = domicilioDesdeMl(fiscal?.address)

  const r: CompradorMl = {
    packId,
    total: totalDe(orders),
    fecha: first.date_closed ?? first.date_created ?? '',
    buyerNickname: first.buyer?.nickname ?? null,
    cuit: null,
    origen: 'manual-requerido',
    documentoMl,
    nombreMl: textoLimpio(fiscal?.name),
    condicionMl: fiscal?.taxpayerType ?? null,
    domicilioMl,
    fiscalError,
    candidatos: [],
    padron: null,
    razonSocial: null,
    activo: null,
    domicilioPadron: null,
    clase: null,
    condicionIva: null,
    receptor: null,
    nombreSugerido: null,
    domicilioSugerido: null,
    motivo: null,
    facturaEnMl: null,
    posibleDuplicado: null,
    yaFacturada: null,
  }

  let consulta: ConsultaPadronComprador | null = null
  const manual = textoLimpio(cuitManual, 40)
  if (manual) {
    const c = normalizeCuit(manual)
    if (!c || !esCuitValido(c)) {
      throw new FacturacionMlError(`El CUIT/CUIL ${manual} no es válido (dígito verificador)`, 400, { codigo: 'CUIT_INVALIDO' })
    }
    r.cuit = c
    r.origen = 'manual'
  } else if (documentoMl?.tipo === 'CUIT' && esCuitValido(documentoMl.numero)) {
    r.cuit = documentoMl.numero
    r.origen = 'ml'
  } else if (documentoMl?.tipo === 'DNI') {
    const d = await resolverCuilDesdeDni(documentoMl.numero, r.nombreMl)
    r.candidatos = d.candidatos
    if (d.cuit) {
      r.cuit = d.cuit
      r.origen = 'padron'
      consulta = d.consulta
    } else {
      r.motivo = d.error
        ? `ML solo informó el DNI ${documentoMl.numero} y no se pudo consultar ARCA para buscar el CUIL (${d.error}). Ingresá el CUIT/CUIL del comprador.`
        : d.ambiguo
          ? `ML solo informó el DNI ${documentoMl.numero} y ARCA tiene más de un CUIL con ese número: ${cuilsEncontradosTexto(d.candidatos)}${r.nombreMl ? ` (el nombre de ML, "${r.nombreMl}", no permite elegir)` : ''}. Elegí el del comprador.`
          : `ML solo informó el DNI ${documentoMl.numero} y ARCA no reconoce ninguno de sus CUIL posibles (${d.candidatos.map((c) => c.cuit).join(', ')}). Ingresá el CUIT/CUIL del comprador: hace falta para darlo de alta en Colppy con su cuenta corriente.`
    }
  } else if (documentoMl?.tipo === 'CUIT') {
    r.motivo = `El CUIT/CUIL que informó ML (${documentoMl.numero}) no es válido. Ingresá el correcto.`
  } else {
    r.motivo = 'ML no informó el documento del comprador. Ingresá su CUIT/CUIL: hace falta para darlo de alta en Colppy con su cuenta corriente.'
  }

  if (r.cuit) {
    // Error de ARCA que no es "no existe": motivo y sin letra (el borrador no emite)
    try {
      consulta ??= await consultarPadronComprador(r.cuit)
    } catch (e) {
      r.motivo = mensajeErrorPadron(e)
    }
    if (consulta) {
      r.padron = consulta.estado
      if (consulta.estado === 'encontrado') {
        r.razonSocial = consulta.persona.razonSocial || null
        r.activo = consulta.persona.activo
        r.domicilioPadron = domicilioDesdePadron(consulta.persona)
      }
      // Mismas guardas que al emitir: condición incierta, corte de la letra y
      // cliente del ERP que no se baja solo. Si alguna falla, la letra queda
      // en null (no se ofrece "Pasar a Factura X") y se muestra el motivo.
      try {
        const decision = decidirFacturaMl(r.cuit, consulta)
        r.condicionIva = decision.taxCondition
        verificarCorteMl(decision.clase, fechaVentaMl(orders))
        const clienteErp = await prisma.customer.findFirst({ where: buildCuitWhereClause(r.cuit) })
        verificarCondicionClienteErp(clienteErp, r.cuit, decision)
        r.clase = decision.clase
        r.receptor = { docTipo: decision.docTipo, docNro: decision.docNro }
      } catch (e) {
        r.motivo = e instanceof FacturacionMlError ? e.message : `No se pudo verificar al comprador: ${(e as Error).message}`
      }
    }
  }
  r.nombreSugerido = r.razonSocial ?? r.nombreMl ?? r.buyerNickname
  r.domicilioSugerido = r.domicilioPadron ?? domicilioMl

  r.facturaEnMl = await facturaAdjuntaEnMl(packId)
  if (r.cuit) {
    try {
      const dups = await buscarPosiblesDuplicados([{ clave: packId, cuit: r.cuit, total: r.total, fecha: new Date(r.fecha) }])
      r.posibleDuplicado = dups.get(packId) ?? null
    } catch (e) {
      logger.warn(`[ML Facturación] No se pudo buscar facturas duplicadas de ${packId}: ${(e as Error).message}`)
    }
  }
  return r
}

// ---------------------------------------------------------------------------
// Emisión
// ---------------------------------------------------------------------------

export interface ResultadoFacturaMl {
  clase: ClaseFacturaMl
  invoiceId: string
  invoiceNumber: string
  cae: string
  colppyPendiente: boolean
  /** FCE MiPyME: quedó como BORRADOR en Colppy (tildar FCE y aprobar). */
  colppyBorradorFce: boolean
  mlUpload: { ok: boolean; error?: string }
}

async function ordenesDelPack(packId: string): Promise<MlSaleOrder[]> {
  try {
    const pack = await getPack(packId)
    return Promise.all(pack.orders.map((o) => getSaleOrder(o.id)))
  } catch (e) {
    // Venta sin pack: la clave es el id de la orden
    if (e instanceof MlApiError && (e.status === 404 || e.status === 400)) return [await getSaleOrder(packId)]
    throw e
  }
}

/** Línea del borrador revisado por el usuario (precio FINAL con IVA, como en ML). */
export interface LineaFacturaMl {
  productId: string | null
  descripcion: string
  cantidad: number
  precioFinal: number
}

export async function facturarVentaMl(params: {
  packId: string
  /** Pestaña desde la que se factura; la letra la confirma el padrón de ARCA */
  clase: ClaseFacturaMl
  cuitManual?: string | null
  /** Líneas editadas en el borrador; si faltan se arman desde la orden de ML */
  lineas?: LineaFacturaMl[] | null
  /** El usuario confirmó emitir aunque la venta ya tenga una factura adjunta en ML */
  confirmarFacturaEnMl?: boolean
  /**
   * Lo que el borrador mostraba cuando el usuario confirmó: true = "ya tiene
   * factura en ML", null = "ML no pudo verificarlo". Si ahora ML dice que HAY
   * factura y lo confirmado no era eso, hay que volver a confirmar (409).
   */
  estadoFacturaEnMlConfirmado?: boolean | null
  /** Factura B: nombre y domicilio del borrador para el alta, si ARCA no tiene al comprador */
  nombre?: string | null
  domicilio?: Partial<DomicilioComprador> | null
  user: { id: string }
}): Promise<ResultadoFacturaMl> {
  const { packId, clase, user } = params

  if (clase !== 'A' && clase !== 'B') {
    throw new FacturacionMlError('Falta indicar la factura a emitir (A o B)', 400, { codigo: 'CLASE_INVALIDA' })
  }
  if (getEmisorFacturacion() !== 'arca') {
    throw new FacturacionMlError('La emisión propia (ARCA PV 7) no está activa en el servidor', 503)
  }

  // Primero el candado del ERP: una venta ya facturada (o en emisión) desde el
  // ERP no debe llegar al aviso de "factura en ML" (que ofrecería emitir igual).
  // El create con P2002 de más abajo sigue siendo el candado a prueba de carreras.
  if (await prisma.mlOrderInvoice.findUnique({ where: { packId } })) {
    throw new FacturacionMlError('Esta venta ya fue facturada (o se está facturando en este momento)', 409, { codigo: 'YA_FACTURADA' })
  }

  const orders = await ordenesDelPack(packId)
  const noPagas = orders.filter((o) => o.status !== 'paid')
  if (noPagas.length) {
    throw new FacturacionMlError(`La venta tiene órdenes que no están pagas (${noPagas.map((o) => `${o.id}: ${o.status}`).join(', ')})`)
  }

  // Doble factura en ML: la venta ya tiene una adjunta (p. ej. hecha en Colppy).
  // Si ML no lo pudo confirmar (null) se trata igual: solo con la confirmación
  // del borrador (antes se seguía de largo y podía quedar facturada dos veces).
  // La confirmación vale para lo que el usuario vio: haber confirmado "ML no
  // pudo verificarlo" no alcanza si ahora ML dice que la venta TIENE factura.
  const enMl = await facturaAdjuntaEnMl(packId, { fresco: true })
  const confirmado = params.confirmarFacturaEnMl === true && (enMl !== true || params.estadoFacturaEnMlConfirmado === true)
  if (enMl !== false && !confirmado) {
    throw new FacturacionMlError(
      enMl === null
        ? 'No se pudo verificar en Mercado Libre si la venta ya tiene factura; confirmalo en el borrador'
        : 'Esta venta ya tiene una factura adjunta en Mercado Libre (p. ej. hecha en Colppy). Si igual corresponde facturarla desde el ERP, confirmalo en el borrador.',
      409,
      { codigo: 'FACTURA_EN_ML', facturaEnMl: enMl }
    )
  }
  if (enMl === null) logger.warn(`[ML Facturación] ML no confirmó si el pack ${packId} ya tiene factura: se sigue por confirmación del usuario`)

  // CUIT/CUIL: el del borrador (pre-cargado con el de ML, editable); si no vino, el de ML
  let cuit = normalizeCuit(params.cuitManual)
  let consulta: ConsultaPadronComprador | null = null
  if (clase === 'B' && params.cuitManual && (!cuit || !esCuitValido(cuit))) {
    throw new FacturacionMlError(`El CUIT/CUIL ${params.cuitManual} no es válido (dígito verificador)`, 400, { codigo: 'CUIT_INVALIDO' })
  }

  // Datos fiscales de ML: el CUIT si no vino del borrador y, en la B, nombre y domicilio para el alta
  let fiscal: MlBuyerFiscal | null = null
  if (!cuit || clase === 'B') {
    try {
      fiscal = await fiscalDelComprador(orders[0])
    } catch (e) {
      logger.warn(`[ML Facturación] Sin datos fiscales de ML para ${packId}: ${(e as Error).message}`)
    }
  }
  if (!cuit) {
    const doc = documentoDeFiscal(fiscal)
    if (doc?.tipo === 'CUIT') {
      cuit = doc.numero
      if (clase === 'B' && !esCuitValido(cuit)) {
        throw new FacturacionMlError(`El CUIT/CUIL que informó ML (${cuit}) no es válido: ingresalo en el borrador`, 422, { codigo: 'CUIT_REQUERIDO' })
      }
    } else if (doc?.tipo === 'DNI' && clase === 'B') {
      // ML solo dio el DNI: el CUIL que ARCA conozca (20, 27, 23, 24)
      const r = await resolverCuilDesdeDni(doc.numero, fiscal?.name)
      if (r.error) {
        logger.warn(`[ML Facturación] Padrón de ARCA caído buscando el CUIL del DNI ${doc.numero} (pack ${packId}): ${r.error}`)
        throw new FacturacionMlError(`No se pudo consultar ARCA para buscar el CUIL del DNI ${doc.numero}: ${r.error}`, 502)
      }
      if (r.ambiguo) {
        throw new FacturacionMlError(
          `El DNI ${doc.numero} tiene más de un CUIL en ARCA (${cuilsEncontradosTexto(r.candidatos)}): elegí el del comprador en el borrador`,
          422,
          { codigo: 'CUIT_REQUERIDO' }
        )
      }
      cuit = r.cuit
      consulta = r.consulta
    }
  }
  if (!cuit) {
    throw new FacturacionMlError(
      clase === 'B'
        ? 'Falta el CUIT/CUIL del comprador (ML no lo informó o ARCA no reconoce el CUIL de su DNI): ingresalo en el borrador'
        : 'Falta el CUIT del comprador',
      422,
      { codigo: 'CUIT_REQUERIDO' }
    )
  }

  // La condición fiscal (y la letra) manda ARCA, no ML. Un error del padrón que
  // no sea "no existe" corta acá (502 con el mensaje de ARCA): nada se emite.
  if (!consulta) {
    try {
      consulta = await consultarPadronComprador(cuit)
    } catch (e) {
      const mensaje = mensajeErrorPadron(e)
      logger.warn(`[ML Facturación] Padrón de ARCA con error para ${cuit} (pack ${packId}): ${mensaje}`)
      throw new FacturacionMlError(mensaje, 502)
    }
  }
  const decision = decidirFacturaMl(cuit, consulta)
  // Mismo orden de guardas que /comprador (resolverCompradorMl), para que el
  // POST y el borrador den la misma respuesta:
  // 1. Corte de la letra que decidió ARCA (antes del "va por la otra pestaña":
  //    no tiene sentido mandar a la otra pestaña una venta que va por Colppy)
  verificarCorteMl(decision.clase, fechaVentaMl(orders))
  // 2. Cliente del ERP (por CUIT/CUIL): nunca se lo baja solo de RI/Monotributo
  //    (un RI del ERP que ARCA da como CF es CONDICION_DISTINTA_ERP, no "pasar a la B")
  const clienteErp = await prisma.customer.findFirst({ where: buildCuitWhereClause(cuit) })
  verificarCondicionClienteErp(clienteErp, cuit, decision)
  // 3. Pestaña equivocada
  if (decision.clase !== clase) throw errorClaseIncorrecta(cuit, consulta, decision)
  const persona = consulta.estado === 'encontrado' ? consulta.persona : null

  const lineas = await armarLineas(orders, params.lineas)

  // Candado contra doble facturación (packId unique)
  const total = totalDe(orders)
  try {
    await prisma.mlOrderInvoice.create({
      data: {
        packId,
        orderIds: orders.map((o) => String(o.id)),
        buyerNickname: orders[0].buyer?.nickname ?? null,
        cuit,
        total,
        createdById: user.id,
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new FacturacionMlError('Esta venta ya fue facturada (o se está facturando en este momento)', 409, { codigo: 'YA_FACTURADA' })
    }
    throw e
  }

  const liberarCandado = () => prisma.mlOrderInvoice.delete({ where: { packId } }).catch(() => undefined)
  let hookArca: HookEmisionArca | null = null

  try {
    // Cliente: el del ERP (por CUIT/CUIL) o alta con los datos de ARCA / del borrador / de ML
    let customer = clienteErp
    if (!customer) {
      let nombre: string
      let domicilio: DomicilioComprador | null
      if (clase === 'A') {
        nombre = persona!.razonSocial
        domicilio = domicilioDesdePadron(persona!)
      } else {
        nombre = (
          textoLimpio(persona?.razonSocial) ??
          textoLimpio(params.nombre) ??
          textoLimpio(fiscal?.name) ??
          textoLimpio(orders[0].buyer?.nickname) ??
          `COMPRADOR ML ${packId}`
        ).toUpperCase()
        domicilio = (persona && domicilioDesdePadron(persona)) ?? domicilioDesdeBorrador(params.domicilio) ?? domicilioDesdeMl(fiscal?.address)
      }
      try {
        customer = await prisma.customer.create({
          data: {
            name: nombre,
            businessName: nombre,
            type: persona?.tipoPersona === 'JURIDICA' ? 'BUSINESS' : 'INDIVIDUAL',
            cuit,
            taxCondition: decision.taxCondition,
            address: domicilio?.direccion || null,
            city: domicilio?.localidad || null,
            province: domicilio?.provincia || null,
            postalCode: domicilio?.codigoPostal || null,
            notes: `Alta automática desde venta de Mercado Libre #${packId}`,
          },
        })
        logger.info(`[ML Facturación] Cliente creado (${persona ? 'ARCA' : 'datos de ML'}): ${customer.name} (${cuit}, ${decision.taxCondition})`)
      } catch (e) {
        // Customer.cuit es único: otra venta del mismo comprador nuevo lo dio de
        // alta recién. Se usa ese (con las mismas guardas que un cliente existente).
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
        customer = await prisma.customer.findFirst({ where: buildCuitWhereClause(cuit) })
        if (!customer) throw e
        logger.info(`[ML Facturación] ${cuit} lo dio de alta otra venta recién: se usa ${customer.name}`)
        verificarCondicionClienteErp(customer, cuit, decision)
      }
    }
    if (customer.taxCondition !== decision.taxCondition) {
      // Solo cambios permitidos (verificarCondicionClienteErp ya frenó RI/Monotributo → CF/Exento)
      logger.info(`[ML Facturación] ${customer.name} (${cuit}): condición ${customer.taxCondition} → ${decision.taxCondition} (ARCA)`)
      customer = await prisma.customer.update({ where: { id: customer.id }, data: { taxCondition: decision.taxCondition } })
    }

    const referencia = `Venta Mercado Libre #${packId}`
    hookArca = crearHookEmisionArca({
      name: customer.name,
      cuit,
      taxCondition: decision.taxCondition,
      fceObligado: customer.fceObligado,
      // B: el documento que va a ARCA puede ser CUIL (86) o DNI (96)
      ...(decision.clase === 'B' ? { documentoReceptorB: { docTipo: decision.docTipo, docNro: decision.docNro } } : {}),
    })

    const colppyResult = await sendQuoteToColppy(
      {
        action: 'factura-contado',
        condicionPago: 'Contado',
        descripcion: referencia,
        emisionExterna: hookArca.hook,
      },
      {
        id: `ml-${packId}`,
        quoteNumber: `ML ${packId}`,
        currency: 'ARS',
        exchangeRate: null,
        bonification: 0,
        pricesIncludeTax: true,
        // Colppy busca el cliente por CUIT/CUIL y lo da de alta si no existe:
        // un cliente por comprador, para su cuenta corriente
        customer: {
          name: customer.name,
          cuit,
          taxCondition: decision.taxCondition,
          address: customer.address ?? undefined,
          city: customer.city ?? undefined,
          postalCode: customer.postalCode ?? undefined,
          province: customer.province ?? undefined,
          phone: customer.phone ?? undefined,
          email: customer.email ?? undefined,
        },
        items: lineas.map((l) => ({
          productName: l.productName,
          productSku: l.productSku,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          comentario: referencia,
        })),
      }
    )

    const emision = hookArca.getEmision()
    if (!colppyResult.success && !emision) {
      // Se le pidió el CAE a ARCA y no hubo respuesta (o no se sabe qué pasó):
      // pudo haberlo autorizado. El candado queda en EMITIENDO (la venta pasa a
      // "revisar" en las dos pestañas) para que un reintento no saque otro CAE.
      const intento = hookArca.getIntentoEmision()
      if (!emisionDescartada(intento)) {
        const cbte = `${intento ? describeCbteTipo(intento.cbteTipo) : 'Factura'} PV ${String(intento?.puntoVenta ?? '?').padStart(4, '0')} N° ${intento?.numero ?? 'desconocido'}`
        logger.error(`[ML_ARCA_INCIERTO] ARCA no confirmó la factura de una venta ML: el candado queda en EMITIENDO. Revisar con: npx tsx scripts/ml-reconciliar-emitiendo.ts --pack ${packId}`, {
          packId,
          cbteTipo: intento?.cbteTipo ?? null,
          puntoVenta: intento?.puntoVenta ?? null,
          numeroEsperado: intento?.numero ?? null,
          estado: intento?.estado ?? null,
          error: colppyResult.error,
        })
        throw new FacturacionMlError(
          `ARCA no confirmó la factura: NO reintentes; queda para revisar (${cbte}: ${colppyResult.error ?? 'sin respuesta'})`,
          502,
          { codigo: 'ARCA_INCIERTO' }
        )
      }
      // ARCA falló antes de recibir el pedido (WSAA, último número): no se emitió nada
      if (intento?.estado === 'no-solicitada') {
        throw new FacturacionMlError(`No se pudo pedir el CAE a ARCA (no se emitió nada; se puede reintentar): ${colppyResult.error}`, 502)
      }
      const prefix = colppyResult.errorStage === 'arca' ? 'ARCA rechazó la factura' : 'Error al registrar en Colppy'
      throw new FacturacionMlError(`${prefix}: ${colppyResult.error}`, colppyResult.errorStage === 'arca' ? 422 : 500)
    }
    const emitida = emision!
    const colppyPendiente = !colppyResult.success
    if (colppyPendiente) {
      logger.error('[ARCA_SIN_COLPPY] Venta ML emitida en ARCA pero el alta en Colppy falló', {
        packId,
        numero: emitida.numeroFormateado,
        cae: emitida.cae,
        error: colppyResult.error,
      })
    }

    const payload = colppyResult.colppyInvoicePayload
    // Importes de la Invoice: los del payload (= lo que se informó a ARCA). Sin
    // payload (no debería pasar si ARCA emitió), la regla "total primero" de la B
    const sinPayload = totalesFacturaB(lineas.map((l) => ({ cantidad: l.quantity, precioFinal: l.unitPrice })))
    const invoiceType = [1, 201].includes(emitida.cbteTipo) ? 'A' : 'B'
    const invoiceNumber = `${emitida.cbteTipo >= 201 ? 'FCE' : ''}${invoiceType}-${emitida.numeroFormateado}`
    const now = new Date()

    let invoiceId: string
    try {
      invoiceId = await prisma.$transaction(async (tx) => {
        const inv = await tx.invoice.create({
          data: {
            invoiceNumber,
            invoiceType,
            transactionType: 'SALE',
            customerId: customer!.id,
            userId: user.id,
            status: 'AUTHORIZED',
            currency: 'ARS',
            colppyId: colppyResult.facturaId || null,
            subtotal: payload ? Number(payload.netoGravado) : sinPayload.neto,
            taxAmount: payload ? Number(payload.totalIVA) : sinPayload.iva,
            discount: 0,
            total: payload ? Number(payload.totalFactura) : sinPayload.total,
            balance: payload ? Number(payload.totalFactura) : sinPayload.total,
            issueDate: now,
            dueDate: now,
            notes: `${referencia}. Emitida por el ERP (ARCA) el ${now.toLocaleString('es-AR')}. CAE ${emitida.cae}. ${colppyPendiente ? 'PENDIENTE de registrar en Colppy.' : colppyResult.colppyBorradorFce ? `Borrador FCE en Colppy (${colppyResult.facturaId}): tildar FCE MiPyME y aprobar.` : `Registrada en Colppy (${colppyResult.facturaId}).`}`,
            afipStatus: 'APPROVED',
            paymentStatus: 'UNPAID',
            emitidaPor: 'ARCA',
            pointOfSale: emitida.puntoVenta,
            cbteTipo: emitida.cbteTipo,
            cbteNumero: emitida.numero,
            cae: emitida.cae,
            caeExpiration: emitida.caeVencimiento,
            docTipo: hookArca!.getReceptor()?.docTipo ?? null,
            docNro: hookArca!.getReceptor()?.docNro ?? null,
            qrUrl: hookArca!.getQrUrl(),
            fceVtoPago: hookArca!.getFceVtoPago(),
            arcaObservaciones: emitida.observaciones.length
              ? emitida.observaciones.map((o) => `[${o.Code}] ${o.Msg}`).join(' · ')
              : null,
            colppySyncStatus: colppyPendiente ? 'PENDIENTE' : colppyResult.colppyBorradorFce ? 'BORRADOR_FCE' : 'OK',
            colppySyncError: colppyPendiente ? (colppyResult.error || 'error desconocido').slice(0, 2000) : null,
            colppyPayload: payload ? (JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue) : Prisma.JsonNull,
            items: {
              create: lineas.map((l) => ({
                productId: l.productId,
                sku: l.productSku || null,
                description: l.productName,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                discount: 0,
                taxRate: 21,
                subtotal: Math.round(l.unitPrice * l.quantity * 100) / 100,
              })),
            },
          },
        })
        await tx.mlOrderInvoice.update({
          where: { packId },
          data: { invoiceId: inv.id, status: 'EMITIDA' },
        })
        return inv.id
      })
    } catch (txError) {
      // La factura EXISTE en ARCA: el candado queda puesto (EMITIENDO) para no
      // re-emitir, y el log tiene todo para reconciliar a mano.
      logger.error('[ML_ORPHAN] Venta ML emitida en ARCA pero el ERP no pudo registrarla', {
        packId,
        numero: emitida.numeroFormateado,
        cae: emitida.cae,
        colppyId: colppyResult.facturaId,
        error: (txError as Error).message,
      })
      throw new FacturacionMlError(
        `La factura ${emitida.numeroFormateado} se emitió en ARCA (CAE ${emitida.cae}) pero el ERP no pudo registrarla. NO REINTENTES: avisá a soporte con ese número.`,
        500
      )
    }

    // Id del cliente en Colppy ("Cliente Nro" del PDF), si el ERP no lo tenía
    if (payload?.idCliente && !customer.colppyId) {
      await prisma.customer
        .update({ where: { id: customer.id }, data: { colppyId: String(payload.idCliente) } })
        .catch((e) => logger.warn(`[ML Facturación] No se pudo guardar el id de Colppy de ${customer!.name}: ${(e as Error).message}`))
    }

    const skus = lineas.map((l) => l.productSku).filter(Boolean)
    if (skus.length) syncStockForSkusFireAndForget(skus, { quoteNumber: `ML ${packId}`, action: 'factura-ml' })

    archivarFacturaEnSharePointBg(invoiceId)
    const mlUpload = await subirFacturaAMl(packId)
    logger.info(`[ML Facturación] ${referencia} → ${invoiceNumber} CAE ${emitida.cae} (Colppy ${colppyPendiente ? 'PENDIENTE' : colppyResult.colppyBorradorFce ? 'BORRADOR_FCE' : 'OK'}, ML ${mlUpload.ok ? 'OK' : 'ERROR'})`)

    return {
      clase: decision.clase,
      invoiceId,
      invoiceNumber,
      cae: emitida.cae,
      colppyPendiente,
      colppyBorradorFce: !!colppyResult.colppyBorradorFce,
      mlUpload,
    }
  } catch (e) {
    // El candado se libera SOLO si ARCA seguro no emitió: el hook nunca le pidió
    // el CAE (falló antes, p. ej. el alta en Colppy) o ARCA lo rechazó en forma
    // definitiva. Si emitió (p. ej. falló la persistencia) o el resultado es
    // incierto (corte después de pedir el CAE), queda puesto: nunca re-emitir.
    if (!hookArca || (!hookArca.getEmision() && emisionDescartada(hookArca.getIntentoEmision()))) await liberarCandado()
    throw e
  }
}

/** Líneas a facturar: las del borrador (validadas) o las de la orden de ML. */
async function armarLineas(orders: MlSaleOrder[], editadas?: LineaFacturaMl[] | null) {
  if (editadas?.length) {
    const ids = Array.from(new Set(editadas.map((l) => l.productId).filter((x): x is string => !!x)))
    const productos = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true } })
    const skuPorId = new Map(productos.map((p) => [p.id, p.sku]))
    return editadas.map((l, i) => {
      const cantidad = Number(l.cantidad)
      const precio = Number(l.precioFinal)
      const descripcion = String(l.descripcion ?? '').trim()
      if (!descripcion) throw new FacturacionMlError(`Línea ${i + 1}: falta la descripción`)
      if (!Number.isFinite(cantidad) || cantidad <= 0) throw new FacturacionMlError(`Línea ${i + 1}: cantidad inválida`)
      if (!Number.isFinite(precio) || precio <= 0) throw new FacturacionMlError(`Línea ${i + 1}: precio inválido`)
      if (l.productId && !skuPorId.has(l.productId)) throw new FacturacionMlError(`Línea ${i + 1}: el producto elegido no existe`)
      return {
        productId: l.productId || null,
        productName: descripcion.slice(0, 250),
        productSku: (l.productId && skuPorId.get(l.productId)) || '',
        quantity: cantidad,
        unitPrice: Math.round(precio * 100) / 100, // final con IVA (pricesIncludeTax)
      }
    })
  }

  // Sin borrador: SKU del ERP si la publicación está vinculada
  const itemIds = Array.from(new Set(orders.flatMap((o) => o.order_items.map((i) => i.item.id))))
  const links = await prisma.mlItemLink.findMany({
    where: { mlItemId: { in: itemIds }, status: 'LINKED', productId: { not: null } },
    select: { mlItemId: true, product: { select: { id: true, sku: true, name: true } } },
  })
  const linkPorItem = new Map(links.map((l) => [l.mlItemId, l.product!]))
  return orders.flatMap((o) =>
    o.order_items.map((it) => {
      const p = linkPorItem.get(it.item.id)
      return {
        productId: p?.id ?? null,
        productName: p?.name ?? it.item.title ?? it.item.id,
        productSku: p?.sku ?? '',
        quantity: it.quantity,
        unitPrice: Number(it.unit_price), // final con IVA (pricesIncludeTax)
      }
    })
  )
}

// ---------------------------------------------------------------------------
// PDF → ML
// ---------------------------------------------------------------------------

/** Sube (o re-sube) el PDF de la factura al pack de ML. No lanza. */
export async function subirFacturaAMl(packId: string): Promise<{ ok: boolean; error?: string }> {
  const reg = await prisma.mlOrderInvoice.findUnique({ where: { packId } })
  if (!reg?.invoiceId) return { ok: false, error: 'La venta no tiene factura emitida desde el ERP' }
  try {
    const data = await buildFacturaPdfData(reg.invoiceId)
    if (!data) throw new Error('No se pudo armar el PDF de la factura')
    const pdf = await generateFacturaPDF(data)
    const { id } = await uploadPackFiscalDocument(packId, pdf, facturaPdfFilename(data))
    await prisma.mlOrderInvoice.update({
      where: { packId },
      data: { mlUploadStatus: 'OK', mlUploadError: null, mlFiscalDocumentId: id },
    })
    guardarCache(cacheFacturaEnMl, packId, true, TTL_FACTURA_EN_ML_SI)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof MlApiError ? `${e.message} ${JSON.stringify(e.body).slice(0, 500)}` : (e as Error).message
    logger.error(`[ML Facturación] No se pudo subir la factura al pack ${packId}: ${msg}`)
    await prisma.mlOrderInvoice.update({
      where: { packId },
      data: { mlUploadStatus: 'ERROR', mlUploadError: msg.slice(0, 2000) },
    })
    return { ok: false, error: msg }
  }
}

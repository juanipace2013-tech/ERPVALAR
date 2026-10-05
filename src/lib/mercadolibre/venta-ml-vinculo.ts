/**
 * Vínculo entre una venta de Mercado Libre y la factura del ERP que la
 * factura. Lo comparten la facturación de ML (src/lib/mercadolibre/facturacion.ts)
 * y la factura directa (src/lib/facturacion/factura-directa.ts), que puede
 * vincular una venta (vieja o un caso raro) a una factura hecha a mano.
 *
 *  - ordenesDelPack: órdenes de una clave de venta (pack, o la orden si no
 *    tiene pack). resolverVentaMl además normaliza un order id que pertenece a
 *    un pack a la clave del pack (`pack_id ?? id`, la misma del listado):
 *    si no, el candado quedaría con otra clave y la venta se vería sin facturar.
 *  - facturaAdjuntaEnMl: ¿ML ya tiene una factura adjunta? (con caché).
 *  - Candado MlOrderInvoice (packId unique) contra la doble factura:
 *    tomarCandadoVentaMl (después de todas las validaciones, antes de ARCA),
 *    vincularFacturaAVentaMl (EMITIDA, dentro de la transacción de la Invoice)
 *    y liberarCandadoVentaMl (SOLO si ARCA seguro no emitió).
 *
 * El corte de fechas de la facturación de ML (verificarCorteMl) NO está acá:
 * la factura directa sirve justamente para las ventas anteriores al corte.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { emisionDescartada, type HookEmisionArca } from '@/lib/facturacion/emision-arca'
import { MlApiError, getPack, getPackFiscalDocuments, getSaleOrder, type MlBuyerFiscal, type MlSaleOrder } from './client'
import type { DocumentoComprador, DomicilioComprador } from './facturacion'

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

export type CodigoErrorVentaMl = 'ML_VENTA_NO_EXISTE' | 'ML_NO_PAGADA' | 'YA_FACTURADA'

/** Error de la venta de ML con status HTTP (cada circuito lo traduce a su error). */
export class VentaMlError extends Error {
  constructor(
    readonly codigo: CodigoErrorVentaMl,
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'VentaMlError'
  }
}

export const MENSAJE_VENTA_YA_FACTURADA = 'Esta venta ya fue facturada (o se está facturando en este momento)'

// ---------------------------------------------------------------------------
// Caché (pm2 corre un solo proceso)
// ---------------------------------------------------------------------------

export const HORA_MS = 3600 * 1000
const TTL_FACTURA_EN_ML_SI = 24 * HORA_MS
const TTL_FACTURA_EN_ML_NO = 3 * 60 * 1000

export type EntradaCache<T> = { valor: T; vence: number }

export function leerCache<T>(m: Map<string, EntradaCache<T>>, clave: string): T | undefined {
  const e = m.get(clave)
  if (!e) return undefined
  if (e.vence < Date.now()) {
    m.delete(clave)
    return undefined
  }
  return e.valor
}

export function guardarCache<T>(m: Map<string, EntradaCache<T>>, clave: string, valor: T, ttl: number) {
  if (m.size > 5000) {
    const ahora = Date.now()
    for (const [k, e] of m) if (e.vence < ahora) m.delete(k)
  }
  m.set(clave, { valor, vence: Date.now() + ttl })
}

const cacheFacturaEnMl = new Map<string, EntradaCache<boolean>>()

/** Vacía el caché de "factura adjunta en ML" (tests; lo llama limpiarCachesFacturacionMl). */
export function limpiarCacheFacturaEnMl() {
  cacheFacturaEnMl.clear()
}

/** Después de subir el PDF al pack: la venta ya tiene factura en ML. */
export function marcarFacturaAdjuntaEnMl(packId: string) {
  guardarCache(cacheFacturaEnMl, packId, true, TTL_FACTURA_EN_ML_SI)
}

/**
 * ¿La venta ya tiene una factura adjunta en ML (p. ej. emitida por Colppy)?
 * null = no se pudo verificar. `fresco` saltea el caché (al emitir).
 */
export async function facturaAdjuntaEnMl(packId: string, opts: { fresco?: boolean } = {}): Promise<boolean | null> {
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
// Órdenes de la venta
// ---------------------------------------------------------------------------

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

/** Total cobrado por ML (suma de las órdenes, redondeado a centavos) */
export const totalVentaMl = (orders: MlSaleOrder[]) =>
  Math.round(orders.reduce((s, o) => s + Number(o.total_amount ?? 0), 0) * 100) / 100

/** Órdenes de la clave de venta: las del pack, o la orden si la venta no tiene pack. */
export async function ordenesDelPack(packId: string): Promise<MlSaleOrder[]> {
  try {
    const pack = await getPack(packId)
    return Promise.all(pack.orders.map((o) => getSaleOrder(o.id)))
  } catch (e) {
    // Venta sin pack: la clave es el id de la orden
    if (e instanceof MlApiError && (e.status === 404 || e.status === 400)) return [await getSaleOrder(packId)]
    throw e
  }
}

export interface VentaMlResuelta {
  /** Clave de la venta (pack_id ?? id): la del candado y la del listado de ML */
  packId: string
  orders: MlSaleOrder[]
  fecha: Date
  /** Total cobrado por ML */
  totalMl: number
  buyerNickname: string | null
}

/**
 * Órdenes de una venta a partir del número que tipeó el usuario (pack u
 * orden). Si es una orden que pertenece a un pack, la clave pasa a ser el
 * pack (con todas sus órdenes). 404 de ML → VentaMlError ML_VENTA_NO_EXISTE.
 */
export async function resolverVentaMl(id: string): Promise<VentaMlResuelta> {
  const clave = String(id).trim()
  let packId = clave
  let orders: MlSaleOrder[]
  try {
    orders = await ordenesDelPack(clave)
    const orden = orders.length === 1 ? orders[0] : null
    const packDeLaOrden = orden?.pack_id ? String(orden.pack_id) : null
    if (orden && packDeLaOrden && packDeLaOrden !== clave) {
      // Era el id de una orden de un pack: la venta es el pack entero
      packId = packDeLaOrden
      orders = await ordenesDelPack(packId)
    }
  } catch (e) {
    if (e instanceof MlApiError && (e.status === 404 || e.status === 400)) {
      throw new VentaMlError('ML_VENTA_NO_EXISTE', 404, `La venta ${clave} no existe en Mercado Libre`)
    }
    throw e
  }
  if (!orders.length) throw new VentaMlError('ML_VENTA_NO_EXISTE', 404, `La venta ${clave} no tiene órdenes en Mercado Libre`)
  return {
    packId,
    orders,
    fecha: fechaVentaMl(orders),
    totalMl: totalVentaMl(orders),
    buyerNickname: orders[0].buyer?.nickname ?? null,
  }
}

/** Órdenes del pack que no están pagas (una venta se factura solo si todas lo están) */
export function ordenesNoPagas(orders: MlSaleOrder[]): Array<{ orderId: string; status: string }> {
  return orders.filter((o) => o.status !== 'paid').map((o) => ({ orderId: String(o.id), status: o.status }))
}

function mensajeNoPagas(noPagas: Array<{ orderId: string; status: string }>): string {
  return `La venta tiene órdenes que no están pagas (${noPagas.map((o) => `${o.orderId}: ${o.status}`).join(', ')})`
}

export interface CandadoVentaMl {
  invoiceId: string | null
  invoiceNumber: string | null
  status: string
}

async function candadoDe(packId: string): Promise<CandadoVentaMl | null> {
  const reg = await prisma.mlOrderInvoice.findUnique({
    where: { packId },
    include: { invoice: { select: { id: true, invoiceNumber: true } } },
  })
  return reg ? { invoiceId: reg.invoiceId ?? reg.invoice?.id ?? null, invoiceNumber: reg.invoice?.invoiceNumber ?? null, status: reg.status } : null
}

// ---------------------------------------------------------------------------
// Inspección (sin efectos) y verificación al emitir
// ---------------------------------------------------------------------------

export interface LineaVentaMl {
  productId: string | null
  sku: string | null
  descripcion: string
  cantidad: number
  /** Precio final con IVA (el cobrado en ML) */
  precioUnitario: number
}

export interface InspeccionVentaMl {
  packId: string
  orderIds: string[]
  /** Fecha de la venta (la orden más vieja), ISO */
  fecha: string
  buyerNickname: string | null
  totalMl: number
  pagada: boolean
  noPagas: Array<{ orderId: string; status: string }>
  /** null = ML no entregó los datos fiscales (permiso o error: ver fiscalError) */
  fiscal: MlBuyerFiscal | null
  fiscalError: string | null
  /** Documento del comprador según ML (CUIT/CUIL o DNI) */
  documentoMl: DocumentoComprador | null
  nombreMl: string | null
  domicilioMl: DomicilioComprador | null
  /** Para precargar las líneas de la factura (precios finales, con IVA) */
  lineas: LineaVentaMl[]
  /** true = ML ya tiene una factura adjunta; null = no se pudo verificar */
  facturaEnMl: boolean | null
  /** La venta ya tiene el candado del ERP (facturada o en emisión) */
  yaFacturada: CandadoVentaMl | null
  /** Anterior al corte de la facturación de ML desde el ERP: probablemente la facturó Colppy */
  anteriorAlCorte: boolean
}

/**
 * Datos de una venta para vincularla a una factura directa. Solo informativa
 * (no toma el candado ni emite): al emitir se vuelve a verificar todo con
 * verificarVentaMlFacturable. No aplica el corte de ML (solo lo informa).
 * `fresco`: la factura adjunta en ML se consulta sin caché.
 */
export async function inspeccionarVentaMl(id: string, opts: { fresco?: boolean } = {}): Promise<InspeccionVentaMl> {
  const venta = await resolverVentaMl(id)
  // Import dinámico: facturacion.ts importa este módulo
  const ml = await import('./facturacion')
  const noPagas = ordenesNoPagas(venta.orders)
  const yaFacturada = await candadoDe(venta.packId)
  const corte = Math.max(ml.corteFacturacionMl('A').getTime(), ml.corteFacturacionMl('B').getTime())

  const itemIds = Array.from(new Set(venta.orders.flatMap((o) => o.order_items.map((i) => i.item.id))))
  const links = itemIds.length
    ? await prisma.mlItemLink.findMany({
        where: { mlItemId: { in: itemIds }, status: 'LINKED', productId: { not: null } },
        select: { mlItemId: true, product: { select: { id: true, sku: true, name: true } } },
      })
    : []
  const linkPorItem = new Map(links.map((l) => [l.mlItemId, l.product]))
  const lineas: LineaVentaMl[] = venta.orders.flatMap((o) =>
    o.order_items.map((it) => {
      const p = linkPorItem.get(it.item.id)
      return {
        productId: p?.id ?? null,
        sku: p?.sku ?? null,
        descripcion: (p?.name ?? it.item.title ?? it.item.id).slice(0, 200),
        cantidad: it.quantity,
        precioUnitario: Number(it.unit_price),
      }
    })
  )

  let fiscal: MlBuyerFiscal | null = null
  let fiscalError: string | null = null
  let facturaEnMl: boolean | null = null
  if (!yaFacturada) {
    try {
      fiscal = await ml.fiscalDelComprador(venta.orders[0])
    } catch (e) {
      fiscalError =
        e instanceof MlApiError && e.status === 403 ? 'ML no habilitó los datos fiscales (permiso "Facturación")' : (e as Error).message
    }
    facturaEnMl = await facturaAdjuntaEnMl(venta.packId, { fresco: opts.fresco })
  }

  return {
    packId: venta.packId,
    orderIds: venta.orders.map((o) => String(o.id)),
    fecha: Number.isFinite(venta.fecha.getTime()) ? venta.fecha.toISOString() : '',
    buyerNickname: venta.buyerNickname,
    totalMl: venta.totalMl,
    pagada: noPagas.length === 0,
    noPagas,
    fiscal,
    fiscalError,
    documentoMl: ml.documentoDeFiscal(fiscal),
    nombreMl: fiscal?.name?.trim() || null,
    domicilioMl: ml.domicilioDesdeMl(fiscal?.address),
    lineas,
    facturaEnMl,
    yaFacturada,
    anteriorAlCorte: Number.isFinite(venta.fecha.getTime()) && venta.fecha.getTime() < corte,
  }
}

/**
 * Controles de la venta al emitir (no alcanza con lo que mostró la vista
 * previa): sin candado del ERP (409 YA_FACTURADA), todas las órdenes pagas
 * (422 ML_NO_PAGADA) y la factura adjunta en ML consultada sin caché (la
 * confirmación la decide quien llama). No toma el candado: eso es
 * tomarCandadoVentaMl, después de todas las validaciones.
 */
export async function verificarVentaMlFacturable(id: string): Promise<InspeccionVentaMl> {
  // Primero el candado con el número tal cual (evita llamar a ML si ya está)
  if (await prisma.mlOrderInvoice.findUnique({ where: { packId: String(id).trim() } })) {
    throw new VentaMlError('YA_FACTURADA', 409, MENSAJE_VENTA_YA_FACTURADA)
  }
  const v = await inspeccionarVentaMl(id, { fresco: true })
  if (v.yaFacturada) throw new VentaMlError('YA_FACTURADA', 409, MENSAJE_VENTA_YA_FACTURADA)
  if (!v.pagada) throw new VentaMlError('ML_NO_PAGADA', 422, mensajeNoPagas(v.noPagas))
  return v
}

/** Mensaje de las órdenes no pagas (para la vista previa) */
export { mensajeNoPagas as mensajeVentaMlNoPagada }

// ---------------------------------------------------------------------------
// Candado contra la doble factura (MlOrderInvoice, packId unique)
// ---------------------------------------------------------------------------

/**
 * Toma el candado de la venta: último paso antes de pedir el CAE. El create
 * con P2002 es el candado a prueba de carreras → VentaMlError YA_FACTURADA.
 * `cuitReceptor` y `totalFactura` son los que usa la reconciliación
 * (scripts/ml-reconciliar-emitiendo.ts) para buscar el comprobante en ARCA.
 */
export async function tomarCandadoVentaMl(p: {
  packId: string
  orderIds: string[]
  buyerNickname: string | null
  cuitReceptor: string | null
  totalFactura: number
  userId: string
}): Promise<void> {
  try {
    await prisma.mlOrderInvoice.create({
      data: {
        packId: p.packId,
        orderIds: p.orderIds,
        buyerNickname: p.buyerNickname,
        cuit: p.cuitReceptor,
        total: p.totalFactura,
        createdById: p.userId,
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new VentaMlError('YA_FACTURADA', 409, MENSAJE_VENTA_YA_FACTURADA)
    }
    throw e
  }
}

/** La factura quedó registrada: el candado pasa a EMITIDA con su invoiceId (misma transacción que la Invoice). */
export async function vincularFacturaAVentaMl(tx: Prisma.TransactionClient, packId: string, invoiceId: string): Promise<void> {
  await tx.mlOrderInvoice.update({
    where: { packId },
    data: { invoiceId, status: 'EMITIDA' },
  })
}

/**
 * Libera el candado SOLO si ARCA seguro no emitió: el hook nunca le pidió el
 * CAE (falló antes) o ARCA lo rechazó en forma definitiva. Si emitió (p. ej.
 * falló la persistencia) o el resultado es incierto, queda puesto: nunca
 * re-emitir. Devuelve si lo liberó.
 */
export async function liberarCandadoVentaMl(packId: string, hook: HookEmisionArca | null): Promise<boolean> {
  if (hook && (hook.getEmision() || !emisionDescartada(hook.getIntentoEmision()))) return false
  await prisma.mlOrderInvoice.delete({ where: { packId } }).catch(() => undefined)
  return true
}

// ---------------------------------------------------------------------------
// Comparaciones con lo que informó ML (avisos y confirmaciones)
// ---------------------------------------------------------------------------

/** Prefijos de CUIT/CUIL de personas humanas (el DNI son los 8 dígitos del medio) */
const PREFIJOS_PERSONA = ['20', '23', '24', '27']

const soloDigitos = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '')

/**
 * ¿El documento al que se factura es el del comprador que informa ML?
 *  - 'mismo': mismo CUIT/CUIL, o mismo DNI (el de adentro de un CUIT/CUIL de persona).
 *  - 'otro': persona distinta (pedir confirmación de "facturar a otro titular").
 *  - 'empresa': se factura a un CUIT de empresa (30/33/34) distinto del de ML: solo se informa.
 *  - 'sin-dato': ML no informó el documento (o no hay documento en la factura).
 */
export type TitularVentaMl = 'mismo' | 'otro' | 'empresa' | 'sin-dato'

export function compararTitularVentaMl(docFactura: string | null | undefined, documentoMl: Pick<DocumentoComprador, 'numero'> | null | undefined): TitularVentaMl {
  const f = soloDigitos(docFactura)
  const m = soloDigitos(documentoMl?.numero)
  if (!f || /^0+$/.test(f) || !m) return 'sin-dato'
  if (f === m) return 'mismo'
  if (f.length === 11 && !PREFIJOS_PERSONA.includes(f.slice(0, 2))) return 'empresa'
  const dniDe = (d: string) => (d.length === 11 ? (PREFIJOS_PERSONA.includes(d.slice(0, 2)) ? Number(d.slice(2, 10)) : NaN) : Number(d))
  const dniF = dniDe(f)
  return Number.isFinite(dniF) && dniF === dniDe(m) ? 'mismo' : 'otro'
}

/** El total de la factura difiere del cobrado en ML en 1 peso o más */
export function totalDistintoDeMl(totalFactura: number, totalMl: number): boolean {
  return Math.abs(Number(totalFactura) - Number(totalMl)) >= 1
}

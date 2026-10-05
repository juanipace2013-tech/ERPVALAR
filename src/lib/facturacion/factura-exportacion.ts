/**
 * Factura E (exportación, WSFEX) desde una cotización.
 *
 * Arma los ítems en USD sin IVA con lo pendiente de facturar de la cotización
 * (más líneas manuales de flete o seguro, que no comisionan), emite con
 * emitirExportacion (ciclo idempotente: la fila FacturaExportacion es el
 * diario) y registra la Invoice, la CotizacionFactura (comisiones) y el avance
 * de la cotización.
 *
 * Diseño: docs/FACTURA-E-WSFEX-PLAN.md (secciones 3, 5, 7, 9 y 10).
 *
 *  - v1: solo Factura E (19) por Exporta Simple, en USD y en español.
 *  - Colppy: carga MANUAL (colppySyncStatus 'MANUAL'); el id se pega después
 *    con PATCH /api/facturas/[id]/colppy-id.
 *  - Comisión: solo las líneas de la cotización (el flete/seguro manual no comisiona).
 *  - Si ARCA autorizó pero no se pudo guardar la Invoice, la FacturaExportacion
 *    queda AUTORIZADA sin invoiceId ("huérfana"): scripts/arca-fex-reconciliar.ts
 *    --apply la registra con registrarInvoiceExportacion, sin volver a emitir.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { getArcaConfig, isFacturaExportacionConfigured } from '@/lib/arca/config'
import {
  ESTADO_FEX,
  ExportacionValidacionError,
  aCentavos,
  emitirExportacion,
  normalizarDes,
  numeroInternoExportacion,
  validarExportacion,
  vistaPreviaExportacion,
  type DatosAutorizacion,
  type ExportacionInput,
  type ItemExportacionInput,
  type PersistenciaExportacion,
  type TotalesExportacion,
  type VistaPreviaExportacion,
} from '@/lib/arca/emitir-exportacion'
import {
  FEX_CBTE,
  FEX_OPCIONAL,
  IDIOMA,
  INCOTERMS_EXPORTA_SIMPLE,
  INCOTERMS_SIN_FLETE,
  INCOTERM_DESCRIPCION,
  MONEDA_FEX,
  TIPO_EXPO,
  receptorExportacion,
  type TipoPersonaFex,
} from '@/lib/arca/fex-params'
import {
  fechaDesdeYmd,
  fechaYmdAR,
  fexGetCotizacion,
  formatFexErrores,
  type CotizacionFex,
  type FexCmp,
} from '@/lib/arca/wsfex'
import { buildQrUrl, formatNroComprobante, type ArcaObservacion } from '@/lib/arca/wsfe'
import { esClienteExterior, etiquetaIdFiscal } from '@/lib/cliente-exterior'
import { signoCantidad } from '@/lib/facturacion/cantidades'
import { MARCA_COLPPY_MANUAL } from '@/lib/facturacion/colppy-manual'
import { calcDueDate } from '@/lib/quote-workflow'
import { sincronizarComisionesDeQuote } from '@/lib/comisiones/liquidacion'
import { archivarFacturaEnSharePointBg } from '@/lib/sharepoint/facturas-emitidas'
import { withClientReference } from '@/lib/quotes/client-reference'

// ---------------------------------------------------------------------------
// Constantes y errores
// ---------------------------------------------------------------------------

export const FORMA_PAGO_DEFAULT = 'Transferencia bancaria'
/** Incoterm propuesto para el primer caso (Chile, el flete lo pagamos nosotros) */
export const INCOTERM_DEFAULT = 'CPT'
/** Texto de la nota de la Invoice que el PATCH del colppyId (o el sync) reemplaza */
export { MARCA_COLPPY_MANUAL }
export const MAX_LINEAS_MANUALES = 5

/** Error de negocio con status HTTP (cotización inexistente, estado, configuración). */
export class FacturaExportacionError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly detalle?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'FacturaExportacionError'
  }
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Línea de la cotización elegida en el diálogo */
export interface SeleccionItemExportacion {
  quoteItemId: string
  cantidad: number
  /** USD sin IVA; default el precio unitario de la cotización */
  precioUnitario?: number
  /** Default: la bonificación de la cotización (%) */
  descuentoPct?: number
  /** Default: descripción del ítem de la cotización */
  descripcion?: string
}

/** Línea agregada a mano (flete internacional, seguro): no comisiona ni integra el FOB */
export interface LineaManualExportacion {
  descripcion: string
  /** Default 1 */
  cantidad?: number
  precioUnitario: number
  codigo?: string
}

export interface PedidoFacturaExportacion {
  items: SeleccionItemExportacion[]
  lineasManuales?: LineaManualExportacion[]
  /** N° de DES tal como lo muestra el portal Exporta Simple */
  desNumero?: string
  /** FOB del DES (USD): tiene que ser igual a la mercadería facturada, al centavo */
  fobUSD?: number
  incoterm?: string
  incotermLugar?: string
  formaPago?: string
  obsComerciales?: string
  /** CanMisMonExt: el cliente paga en dólares (default true) */
  cancelaEnMonedaExtranjera?: boolean
  /**
   * Cotización de ARCA que vio el usuario en el diálogo. Si al emitir ARCA ya
   * informa otra, no se emite (409) para que la revise.
   */
  cotizacionEsperada?: number
}

/** Cada Item del Cmp con su vínculo a la cotización (se guarda en FacturaExportacion.lineas) */
export interface LineaExportacion {
  /** null = línea manual (flete, seguro): no comisiona ni descuenta pendiente */
  quoteItemId: string | null
  productId: string | null
  codigo: string | null
  descripcion: string
  cantidad: number
  /** USD sin IVA, antes de la bonificación */
  precioUnitario: number
  descuentoPct: number
  /** Monto USD de la bonificación (Pro_bonificacion) */
  bonificacion: number
  /** USD neto de bonificación (Pro_total_item) */
  subtotal: number
  manual: boolean
}

/** Ítem de cotización con lo necesario para facturarlo (forma plana, testeable) */
export interface QuoteItemExportable {
  id: string
  itemNumber: number
  productId: string | null
  description: string | null
  manualSku: string | null
  /** Referencia interna del cliente (SOLPED, posición...): va al final de la Pro_ds */
  clientReference?: string | null
  product: { sku: string; name: string } | null
  additionals: Array<{ description: string | null; product: { name: string } | null }>
  quantity: number
  /** USD sin IVA (QuoteItem.unitPrice, incluye los adicionales) */
  unitPrice: number
  cantidadPendiente: number
}

export interface DatosAutorizacionRegistro {
  cae: string
  caeVencimiento: Date
  /** yyyymmdd */
  fechaCbte: string
  motivosObs: string | null
  reproceso: boolean
  recuperado: boolean
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

const r2 = (n: number) => Math.round(n * 100) / 100
const r4 = (n: number) => Math.round(n * 10000) / 10000
const limpiar = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const fmtUsd = (n: number) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

/** true si el número tiene como máximo 2 decimales (lo que guarda la Invoice) */
export function tieneHastaDosDecimales(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6
}

/**
 * Cantidad pendiente de facturar de un ítem de cotización: la misma regla que
 * generate-invoice (máximo entre la columna cantidadFacturada y la suma
 * firmada de las líneas de facturas vigentes; las NC restan).
 */
export function cantidadPendienteQuoteItem(qi: {
  quantity: number
  cantidadFacturada: unknown
  invoiceItems: Array<{ quantity: unknown; invoice: { status: string; transactionType?: string | null } }>
}): number {
  const fromInvoiceItems = qi.invoiceItems
    .filter((ii) => ii.invoice.status !== 'CANCELLED')
    .reduce((sum, ii) => sum + signoCantidad(ii.invoice) * Number(ii.quantity), 0)
  const fromColumn = Number(qi.cantidadFacturada)
  return qi.quantity - Math.max(fromInvoiceItems, fromColumn)
}

/** Forma de pago propuesta: la primera línea de las condiciones de la cotización si entra en 50 caracteres. */
export function formaPagoPorDefecto(terms: string | null | undefined): string {
  const primera = (terms ?? '')
    .split(/\r?\n/)
    .map((l) => limpiar(l))
    .find(Boolean)
  return primera && primera.length <= 50 ? primera : FORMA_PAGO_DEFAULT
}

/** Pro_ds de un ítem de la cotización (con los adicionales, que van en el mismo precio). */
export function descripcionQuoteItem(
  qi: Pick<QuoteItemExportable, 'description' | 'product' | 'additionals' | 'clientReference'>,
): string {
  const base = limpiar(qi.description) || limpiar(qi.product?.name) || 'Ítem'
  const adicionales = qi.additionals.map((a) => limpiar(a.product?.name) || limpiar(a.description)).filter(Boolean)
  const conAdicionales = adicionales.length ? `${base} (incluye: ${adicionales.join(', ')})` : base
  return withClientReference(conAdicionales, qi.clientReference)
}

/** Pro_codigo: SKU del producto o el código del ítem manual. */
export function codigoQuoteItem(qi: Pick<QuoteItemExportable, 'product' | 'manualSku'>): string | null {
  return limpiar(qi.product?.sku) || limpiar(qi.manualSku) || null
}

/**
 * Ítems del Cmp (USD sin IVA, bonificación como MONTO) y su vínculo con la
 * cotización. Una línea por ítem de cotización, con el precio unitario de la
 * cotización (que incluye los adicionales); después las líneas manuales.
 * La cantidad contra lo pendiente la valida además buildFexRequest.
 */
export function armarItemsExportacion(
  quoteItems: QuoteItemExportable[],
  pedido: Pick<PedidoFacturaExportacion, 'items' | 'lineasManuales'>,
  bonificacionPct: number
): { items: ItemExportacionInput[]; lineas: LineaExportacion[]; errores: string[] } {
  const errores: string[] = []
  const items: ItemExportacionInput[] = []
  const lineas: LineaExportacion[] = []
  const porId = new Map(quoteItems.map((qi) => [qi.id, qi]))
  const vistos = new Set<string>()

  const agregar = (it: ItemExportacionInput & { descuentoPct: number }, vinculo: { quoteItemId: string | null; productId: string | null }) => {
    const brutoCent = aCentavos(it.cantidad * it.precioUnitario)
    const bonifCent = aCentavos((it.cantidad * it.precioUnitario * it.descuentoPct) / 100)
    const { descuentoPct, ...item } = it
    items.push({ ...item, bonificacion: bonifCent / 100 })
    lineas.push({
      quoteItemId: vinculo.quoteItemId,
      productId: vinculo.productId,
      codigo: it.codigo ?? null,
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      precioUnitario: it.precioUnitario,
      descuentoPct,
      bonificacion: bonifCent / 100,
      subtotal: (brutoCent - bonifCent) / 100,
      manual: !!it.manual,
    })
  }

  if (!pedido.items?.length) errores.push('Elegí al menos un ítem de la cotización')

  for (const sel of pedido.items ?? []) {
    const qi = porId.get(sel.quoteItemId)
    if (!qi) {
      errores.push(`El ítem ${sel.quoteItemId} no pertenece a la cotización (o es una alternativa)`)
      continue
    }
    const nombre = `Ítem ${qi.itemNumber}`
    if (vistos.has(qi.id)) {
      errores.push(`${nombre}: está elegido dos veces`)
      continue
    }
    vistos.add(qi.id)

    const cantidad = Number(sel.cantidad)
    const precio = sel.precioUnitario === undefined ? qi.unitPrice : Number(sel.precioUnitario)
    const pct = sel.descuentoPct === undefined ? bonificacionPct : Number(sel.descuentoPct)
    let ok = true
    if (!(Number.isFinite(cantidad) && cantidad > 0)) {
      errores.push(`${nombre}: la cantidad tiene que ser mayor a cero`)
      ok = false
    } else if (!tieneHastaDosDecimales(cantidad)) {
      errores.push(`${nombre}: la cantidad admite hasta 2 decimales`)
      ok = false
    }
    if (!(Number.isFinite(precio) && precio > 0)) {
      errores.push(`${nombre}: el precio unitario tiene que ser mayor a cero`)
      ok = false
    } else if (!tieneHastaDosDecimales(precio)) {
      errores.push(`${nombre}: el precio unitario admite hasta 2 decimales`)
      ok = false
    }
    if (!(Number.isFinite(pct) && pct >= 0 && pct < 100)) {
      errores.push(`${nombre}: el descuento tiene que estar entre 0 y 100%`)
      ok = false
    }
    if (!ok) continue
    agregar(
      {
        codigo: codigoQuoteItem(qi),
        descripcion: limpiar(sel.descripcion) || descripcionQuoteItem(qi),
        cantidad,
        precioUnitario: precio,
        descuentoPct: pct,
        cantidadPendiente: qi.cantidadPendiente,
      },
      { quoteItemId: qi.id, productId: qi.productId }
    )
  }

  const manuales = pedido.lineasManuales ?? []
  if (manuales.length > MAX_LINEAS_MANUALES) {
    errores.push(`Hasta ${MAX_LINEAS_MANUALES} líneas manuales (flete, seguro)`)
  }
  manuales.slice(0, MAX_LINEAS_MANUALES).forEach((m, i) => {
    const nombre = `Línea manual ${i + 1}`
    const descripcion = limpiar(m.descripcion)
    const cantidad = m.cantidad === undefined ? 1 : Number(m.cantidad)
    const precio = Number(m.precioUnitario)
    let ok = true
    if (!descripcion) {
      errores.push(`${nombre}: falta la descripción (ej. "Flete internacional")`)
      ok = false
    }
    if (!(Number.isFinite(cantidad) && cantidad > 0 && tieneHastaDosDecimales(cantidad))) {
      errores.push(`${nombre}: cantidad inválida`)
      ok = false
    }
    if (!(Number.isFinite(precio) && precio > 0 && tieneHastaDosDecimales(precio))) {
      errores.push(`${nombre}: el importe tiene que ser mayor a cero, con hasta 2 decimales`)
      ok = false
    }
    if (!ok) return
    agregar(
      {
        codigo: limpiar(m.codigo) || null,
        descripcion,
        cantidad,
        precioUnitario: precio,
        descuentoPct: 0,
        manual: true,
      },
      { quoteItemId: null, productId: null }
    )
  })

  return { items, lineas, errores }
}

/**
 * Saldo FOB (USD) de un DES ya usado en comprobantes AUTORIZADOS: facturas y
 * ND suman, NC restan. Exporta Simple admite una sola factura por DES: con
 * saldo > 0 no se puede emitir otra E sobre el mismo DES.
 */
export function saldoFobDes(filas: Array<{ cbteTipo: number; estado: string; fobUSD: number | null }>): number {
  let cent = 0
  for (const f of filas) {
    if (f.estado !== ESTADO_FEX.AUTORIZADA || f.fobUSD === null) continue
    const c = aCentavos(Number(f.fobUSD))
    if (f.cbteTipo === FEX_CBTE.NOTA_CREDITO_E) cent -= c
    else cent += c
  }
  return cent / 100
}

/** Montos de la CotizacionFactura: comisiona SOLO la mercadería (sin flete ni seguro manual). */
export function montosComisionExportacion(
  totales: Pick<TotalesExportacion, 'mercaderiaUSD'>,
  cotizacion: number
): { montoUSD: number; montoARS: number; tipoCambio: number } {
  return {
    montoUSD: r2(totales.mercaderiaUSD),
    montoARS: r2(totales.mercaderiaUSD * cotizacion),
    tipoCambio: r4(cotizacion),
  }
}

/**
 * QR (RG 4892) de la E: moneda DOL y sin documento del receptor (tipoDocRec y
 * nroDocRec son "de corresponder" y un cliente del exterior no tiene).
 */
export function qrUrlExportacion(cmp: Pick<FexCmp, 'Punto_vta' | 'Cbte_Tipo' | 'Cbte_nro' | 'Imp_total' | 'Moneda_ctz'>, p: { cae: string; fechaCbte: string; cuit: string }): string {
  return buildQrUrl({
    fecha: fechaDesdeYmd(p.fechaCbte),
    cuit: p.cuit,
    ptoVta: cmp.Punto_vta,
    tipoCmp: cmp.Cbte_Tipo,
    nroCmp: cmp.Cbte_nro,
    importe: cmp.Imp_total,
    moneda: MONEDA_FEX.DOLAR,
    ctz: cmp.Moneda_ctz,
    codAut: p.cae,
  })
}

/** Valor de un opcional del Cmp (2401 DES, 2402 FOB) */
export function opcionalCmp(cmp: Pick<FexCmp, 'Opcionales'>, id: string): string | null {
  return cmp.Opcionales?.find((o) => o.Id === id)?.Valor ?? null
}

/** Nota de la Invoice de una Factura E */
export function notasFacturaExportacion(p: {
  numeroInterno: string
  cae: string
  emitidaEl: Date
  cmp: Pick<FexCmp, 'Incoterms' | 'Incoterms_Ds' | 'Opcionales' | 'Moneda_ctz'>
  manualUSD: number
  recuperado?: boolean
  reproceso?: boolean
}): string {
  const des = opcionalCmp(p.cmp, FEX_OPCIONAL.DES)
  const fob = opcionalCmp(p.cmp, FEX_OPCIONAL.FOB_DES)
  const fecha = p.emitidaEl.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
  return [
    `Factura E ${p.numeroInterno} (exportación) emitida por el ERP (ARCA WSFEX) el ${fecha}. CAE ${p.cae}.`,
    p.recuperado ? 'CAE recuperado con FEXGetCMP después de un corte.' : p.reproceso ? 'ARCA la devolvió como reproceso del mismo Id.' : '',
    des ? `Exporta Simple: DES ${des}, FOB USD ${fmtUsd(Number(fob))}.` : '',
    p.cmp.Incoterms ? `Incoterm ${p.cmp.Incoterms}${p.cmp.Incoterms_Ds ? ` ${p.cmp.Incoterms_Ds}` : ''}.` : '',
    p.manualUSD > 0 ? `Flete/seguro USD ${fmtUsd(p.manualUSD)} (no comisiona).` : '',
    `TC ARCA ${p.cmp.Moneda_ctz}.`,
    MARCA_COLPPY_MANUAL,
  ]
    .filter(Boolean)
    .join(' ')
}

const esTipo = (v: unknown, t: 'string' | 'number' | 'boolean') => v === undefined || v === null || typeof v === t

/**
 * Valida la FORMA del body del POST (tipos). Las reglas de negocio (DES,
 * FOB, Incoterm, forma de pago...) las valida buildFexRequest con mensajes
 * propios, así que acá los campos de texto pueden venir vacíos.
 */
export function parsePedidoFacturaExportacion(body: unknown): { pedido: PedidoFacturaExportacion | null; errores: string[] } {
  const errores: string[] = []
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { pedido: null, errores: ['Pedido vacío o inválido'] }
  const b = body as Record<string, unknown>

  if (!Array.isArray(b.items)) errores.push('items tiene que ser una lista de { quoteItemId, cantidad }')
  const items: SeleccionItemExportacion[] = (Array.isArray(b.items) ? b.items : []).map((raw, i) => {
    const it = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    if (typeof it.quoteItemId !== 'string' || !it.quoteItemId) errores.push(`items[${i}]: falta quoteItemId`)
    if (typeof it.cantidad !== 'number') errores.push(`items[${i}]: la cantidad tiene que ser un número`)
    if (!esTipo(it.precioUnitario, 'number')) errores.push(`items[${i}]: precioUnitario tiene que ser un número`)
    if (!esTipo(it.descuentoPct, 'number')) errores.push(`items[${i}]: descuentoPct tiene que ser un número`)
    if (!esTipo(it.descripcion, 'string')) errores.push(`items[${i}]: descripcion tiene que ser texto`)
    return {
      quoteItemId: String(it.quoteItemId ?? ''),
      cantidad: Number(it.cantidad),
      precioUnitario: typeof it.precioUnitario === 'number' ? it.precioUnitario : undefined,
      descuentoPct: typeof it.descuentoPct === 'number' ? it.descuentoPct : undefined,
      descripcion: typeof it.descripcion === 'string' ? it.descripcion : undefined,
    }
  })

  if (b.lineasManuales !== undefined && b.lineasManuales !== null && !Array.isArray(b.lineasManuales)) {
    errores.push('lineasManuales tiene que ser una lista de { descripcion, precioUnitario }')
  }
  const lineasManuales: LineaManualExportacion[] = (Array.isArray(b.lineasManuales) ? b.lineasManuales : []).map((raw, i) => {
    const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    if (typeof m.descripcion !== 'string') errores.push(`lineasManuales[${i}]: falta la descripción`)
    if (typeof m.precioUnitario !== 'number') errores.push(`lineasManuales[${i}]: el importe tiene que ser un número`)
    if (!esTipo(m.cantidad, 'number')) errores.push(`lineasManuales[${i}]: la cantidad tiene que ser un número`)
    if (!esTipo(m.codigo, 'string')) errores.push(`lineasManuales[${i}]: el código tiene que ser texto`)
    return {
      descripcion: typeof m.descripcion === 'string' ? m.descripcion : '',
      cantidad: typeof m.cantidad === 'number' ? m.cantidad : undefined,
      precioUnitario: Number(m.precioUnitario),
      codigo: typeof m.codigo === 'string' ? m.codigo : undefined,
    }
  })

  for (const k of ['desNumero', 'incoterm', 'incotermLugar', 'formaPago', 'obsComerciales'] as const) {
    if (!esTipo(b[k], 'string')) errores.push(`${k} tiene que ser texto`)
  }
  if (!esTipo(b.fobUSD, 'number')) errores.push('fobUSD tiene que ser un número')
  if (!esTipo(b.cotizacionEsperada, 'number')) errores.push('cotizacionEsperada tiene que ser un número')
  if (!esTipo(b.cancelaEnMonedaExtranjera, 'boolean')) errores.push('cancelaEnMonedaExtranjera tiene que ser true o false')

  const texto = (v: unknown) => (typeof v === 'string' ? v : undefined)
  return {
    pedido: errores.length
      ? null
      : {
          items,
          lineasManuales,
          desNumero: texto(b.desNumero),
          fobUSD: typeof b.fobUSD === 'number' ? b.fobUSD : undefined,
          incoterm: texto(b.incoterm),
          incotermLugar: texto(b.incotermLugar),
          formaPago: texto(b.formaPago),
          obsComerciales: texto(b.obsComerciales),
          cancelaEnMonedaExtranjera: typeof b.cancelaEnMonedaExtranjera === 'boolean' ? b.cancelaEnMonedaExtranjera : undefined,
          cotizacionEsperada: typeof b.cotizacionEsperada === 'number' ? b.cotizacionEsperada : undefined,
        },
    errores,
  }
}

// ---------------------------------------------------------------------------
// Persistencia (FacturaExportacion = diario de idempotencia)
// ---------------------------------------------------------------------------

/** JSON plano para columnas Json obligatorias de Prisma */
function aJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue
}

/** JSON plano para columnas Json? (null/undefined → JsonNull) */
function aJsonOpcional(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return v === undefined || v === null ? Prisma.JsonNull : aJson(v)
}

const ESTADOS_BLOQUEANTES = [ESTADO_FEX.PENDIENTE, ESTADO_FEX.INCIERTA]

/** Lecturas que usan la emisión y la vista previa */
export const lecturasFacturaExportacion: Pick<PersistenciaExportacion, 'buscarBloqueante' | 'maxFexId'> & {
  ultimoNumeroAutorizado: NonNullable<PersistenciaExportacion['ultimoNumeroAutorizado']>
} = {
  /**
   * PENDIENTE/INCIERTA, o AUTORIZADA sin Invoice (huérfana: tiene CAE pero
   * sus ítems siguen pendientes en la cotización, así que otra emisión
   * facturaría dos veces lo mismo). Todas se resuelven con arca-fex-reconciliar.
   */
  async buscarBloqueante(puntoVenta) {
    const f = await prisma.facturaExportacion.findFirst({
      where: {
        puntoVenta,
        OR: [{ estado: { in: ESTADOS_BLOQUEANTES } }, { estado: ESTADO_FEX.AUTORIZADA, invoiceId: null }],
      },
      orderBy: { fexId: 'asc' },
      select: { fexId: true, estado: true, cbteNumero: true },
    })
    if (!f) return null
    const estado = f.estado === ESTADO_FEX.AUTORIZADA ? 'AUTORIZADA SIN REGISTRAR EN EL ERP' : f.estado
    return { fexId: Number(f.fexId), estado, cbteNumero: f.cbteNumero }
  },
  async maxFexId() {
    const r = await prisma.facturaExportacion.aggregate({ _max: { fexId: true } })
    return r._max.fexId ? Number(r._max.fexId) : 0
  },
  async ultimoNumeroAutorizado(puntoVenta, cbteTipo) {
    const r = await prisma.facturaExportacion.aggregate({
      where: { puntoVenta, cbteTipo, estado: ESTADO_FEX.AUTORIZADA },
      _max: { cbteNumero: true },
    })
    return r._max.cbteNumero ?? 0
  },
}

/**
 * Callbacks de persistencia de emitirExportacion sobre FacturaExportacion.
 * `controlarNumeracion`: compara FEXGetLast_CMP con el último número
 * AUTORIZADO en la DB (solo en prod, donde el PV de exportación es exclusivo
 * del ERP; en homo puede haber comprobantes de prueba hechos por script).
 */
export function persistenciaFacturaExportacion(
  ctx: { quoteId: string | null; customerId: string; userId: string; lineas: LineaExportacion[]; asociadoInvoiceId?: string | null },
  opts: { controlarNumeracion?: boolean } = {}
): PersistenciaExportacion {
  return {
    buscarBloqueante: lecturasFacturaExportacion.buscarBloqueante,
    maxFexId: lecturasFacturaExportacion.maxFexId,
    ...(opts.controlarNumeracion ? { ultimoNumeroAutorizado: lecturasFacturaExportacion.ultimoNumeroAutorizado } : {}),

    async reservar(r) {
      const fob = opcionalCmp(r.cmp, FEX_OPCIONAL.FOB_DES)
      await prisma.facturaExportacion.create({
        data: {
          fexId: BigInt(r.fexId),
          cbteTipo: r.cbteTipo,
          puntoVenta: r.puntoVenta,
          cbteNumero: r.cbteNumero,
          numeroOcupado: r.cbteNumero,
          estado: ESTADO_FEX.PENDIENTE,
          regimen: r.input.regimen,
          tipoExpo: r.cmp.Tipo_expo,
          desNumero: opcionalCmp(r.cmp, FEX_OPCIONAL.DES),
          fobUSD: fob !== null ? Number(fob) : null,
          permisoExistente: r.cmp.Permiso_existente || null,
          permisos: r.cmp.Permisos?.length ? aJson(r.cmp.Permisos) : Prisma.JsonNull,
          dstCmp: r.cmp.Dst_cmp,
          cuitPais: r.cmp.Cuit_pais_cliente ?? null,
          idImpositivo: r.cmp.Id_impositivo ?? null,
          domicilio: r.cmp.Domicilio_cliente,
          incoterm: r.cmp.Incoterms ?? null,
          incotermDs: r.cmp.Incoterms_Ds ?? null,
          formaPago: r.cmp.Forma_pago ?? null,
          idioma: r.cmp.Idioma_cbte,
          monedaCtz: r.cmp.Moneda_ctz,
          canMisMonExt: r.cmp.CanMisMonExt ?? null,
          obsComerciales: r.cmp.Obs_comerciales ?? null,
          totalUSD: r.totales.totalUSD,
          mercaderiaUSD: r.totales.mercaderiaUSD,
          manualUSD: r.totales.manualUSD,
          request: aJson(r.cmp),
          cmpXml: r.cmpXml,
          lineas: aJson(ctx.lineas),
          asociadoInvoiceId: ctx.asociadoInvoiceId ?? null,
          quoteId: ctx.quoteId,
          customerId: ctx.customerId,
          createdById: ctx.userId,
        },
      })
    },

    async marcarAutorizada(fexId, d: DatosAutorizacion) {
      await prisma.facturaExportacion.update({
        where: { fexId: BigInt(fexId) },
        data: {
          estado: ESTADO_FEX.AUTORIZADA,
          cae: d.cae,
          caeVencimiento: d.caeVencimiento,
          fechaCbte: d.fechaCbte,
          reproceso: d.reproceso,
          recuperado: d.recuperado,
          motivosObs: d.motivosObs,
          response: aJsonOpcional(d.response),
          errores: null,
        },
      })
    },

    async marcarRechazada(fexId, d) {
      await prisma.facturaExportacion.update({
        where: { fexId: BigInt(fexId) },
        data: {
          estado: ESTADO_FEX.RECHAZADA,
          // ARCA no consume el número de un rechazo: lo libera para el próximo intento
          numeroOcupado: null,
          errores: (formatFexErrores(d.errores) || d.mensaje).slice(0, 4000),
          response: aJsonOpcional(d.response),
        },
      })
    },

    async marcarIncierta(fexId, d) {
      await prisma.facturaExportacion.update({
        where: { fexId: BigInt(fexId) },
        data: { estado: ESTADO_FEX.INCIERTA, errores: d.mensaje.slice(0, 4000), response: aJsonOpcional(d.response) },
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Carga de la cotización
// ---------------------------------------------------------------------------

const QUOTE_INCLUDE = {
  customer: {
    select: {
      id: true,
      name: true,
      businessName: true,
      type: true,
      taxCondition: true,
      country: true,
      address: true,
      city: true,
      taxIdExterior: true,
      paymentTerms: true,
    },
  },
  items: {
    where: { isAlternative: false },
    orderBy: { itemNumber: 'asc' as const },
    include: {
      product: { select: { sku: true, name: true } },
      additionals: { orderBy: { position: 'asc' as const }, select: { description: true, product: { select: { name: true } } } },
      invoiceItems: { select: { quantity: true, invoice: { select: { status: true, transactionType: true } } } },
    },
  },
} satisfies Prisma.QuoteInclude

type QuoteConItems = Prisma.QuoteGetPayload<{ include: typeof QUOTE_INCLUDE }>

async function cargarCotizacion(quoteId: string): Promise<QuoteConItems> {
  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, include: QUOTE_INCLUDE })
  if (!quote) throw new FacturaExportacionError('Cotización no encontrada', 404)
  return quote
}

function quoteItemsExportables(quote: QuoteConItems): QuoteItemExportable[] {
  return quote.items.map((qi) => ({
    id: qi.id,
    itemNumber: qi.itemNumber,
    productId: qi.productId,
    description: qi.description,
    manualSku: qi.manualSku,
    clientReference: qi.clientReference,
    product: qi.product,
    additionals: qi.additionals,
    quantity: qi.quantity,
    unitPrice: Number(qi.unitPrice),
    cantidadPendiente: cantidadPendienteQuoteItem(qi),
  }))
}

/** Bloqueos de la cotización/cliente que no dependen de lo elegido en el diálogo */
function bloqueosCotizacion(quote: QuoteConItems): string[] {
  const b: string[] = []
  if (quote.status !== 'ACCEPTED' && quote.status !== 'FACTURADA_PARCIAL') {
    b.push(`Solo se facturan cotizaciones aceptadas o con facturación parcial (estado actual: ${quote.status})`)
  }
  if (!esClienteExterior(quote.customer)) {
    b.push('El cliente no es del exterior: la Factura E es solo para exportaciones (para clientes argentinos, Factura A/B)')
  }
  if (quote.currency !== 'USD') b.push('La Factura E se emite en dólares: la cotización tiene que estar en USD')
  return b
}

/** DES ya usado en otra E AUTORIZADA con saldo FOB (Exporta Simple: una factura por DES) */
async function erroresDesUsado(desRaw: string | undefined): Promise<string[]> {
  const des = normalizarDes(desRaw)
  if (!des) return []
  const filas = await prisma.facturaExportacion.findMany({
    where: { desNumero: des, estado: ESTADO_FEX.AUTORIZADA },
    select: { cbteTipo: true, estado: true, fobUSD: true, puntoVenta: true, cbteNumero: true },
  })
  const saldo = saldoFobDes(filas.map((f) => ({ ...f, fobUSD: f.fobUSD === null ? null : Number(f.fobUSD) })))
  if (saldo <= 0) return []
  const usadas = filas
    .filter((f) => f.cbteTipo === FEX_CBTE.FACTURA_E)
    .map((f) => numeroInternoExportacion(f.cbteTipo, f.puntoVenta, f.cbteNumero))
  return [
    `El DES ${des} ya se usó en ${usadas.join(', ') || 'otra Factura E'} (saldo FOB USD ${fmtUsd(saldo)}): ` +
      'Exporta Simple admite una sola factura por DES. Generá un DES nuevo para esta operación',
  ]
}

// ---------------------------------------------------------------------------
// Prellenado del diálogo (GET)
// ---------------------------------------------------------------------------

export interface PrefillFacturaExportacion {
  /** ARCA + ARCA_PUNTO_VENTA_EXPO configurados */
  configurado: boolean
  ambiente: 'prod' | 'homo' | null
  puntoVenta: number | null
  quote: {
    id: string
    quoteNumber: string
    status: string
    currency: string
    bonificacionPct: number
    purchaseOrderNumber: string | null
  }
  cliente: {
    id: string
    nombre: string
    pais: string | null
    iso: string | null
    etiquetaIdFiscal: string
    idImpositivo: string | null
    cuitPais: string | null
    tipoPersona: TipoPersonaFex
    domicilio: string | null
    dstCmp: number | null
  }
  /** Datos del cliente que faltan para emitir (link a "Editar cliente") */
  faltantesCliente: string[]
  advertenciasCliente: string[]
  /** Todo lo que impide emitir (vacío = se puede) */
  bloqueos: string[]
  items: Array<{
    quoteItemId: string
    itemNumber: number
    codigo: string | null
    descripcion: string
    cantidadCotizada: number
    cantidadPendiente: number
    precioUnitario: number
    descuentoPct: number
    /** Con la cantidad pendiente y el descuento de la cotización */
    subtotal: number
  }>
  /** Cotización oficial DOL de ARCA (con la fecha que respondió) */
  cotizacion: CotizacionFex | null
  cotizacionError: string | null
  /** Comprobante de exportación PENDIENTE/INCIERTO que bloquea emitir */
  comprobanteSinResolver: { fexId: number; estado: string; cbteNumero: number; numero: string } | null
  defaults: {
    regimen: 'EXPORTA_SIMPLE'
    incoterm: string
    incotermLugar: string
    formaPago: string
    cancelaEnMonedaExtranjera: boolean
    idioma: number
  }
  incoterms: Array<{ codigo: string; descripcion: string; sinFlete: boolean }>
}

export async function prefillFacturaExportacion(quoteId: string): Promise<PrefillFacturaExportacion> {
  const quote = await cargarCotizacion(quoteId)
  const configurado = isFacturaExportacionConfigured()
  const cfg = configurado ? getArcaConfig() : null
  const pv = cfg?.puntoVentaExportacion ?? null

  const rec = receptorExportacion(quote.customer)
  const bonificacionPct = Number(quote.bonification ?? 0) || 0
  const items = quoteItemsExportables(quote)
    .filter((qi) => qi.cantidadPendiente > 0)
    .map((qi) => {
      const brutoCent = aCentavos(qi.cantidadPendiente * qi.unitPrice)
      const bonifCent = aCentavos((qi.cantidadPendiente * qi.unitPrice * bonificacionPct) / 100)
      return {
        quoteItemId: qi.id,
        itemNumber: qi.itemNumber,
        codigo: codigoQuoteItem(qi),
        descripcion: descripcionQuoteItem(qi),
        cantidadCotizada: qi.quantity,
        cantidadPendiente: qi.cantidadPendiente,
        precioUnitario: qi.unitPrice,
        descuentoPct: bonificacionPct,
        subtotal: (brutoCent - bonifCent) / 100,
      }
    })

  const bloqueos = bloqueosCotizacion(quote)
  if (!configurado) {
    bloqueos.push('Factura E no configurada: faltan las variables ARCA_* o ARCA_PUNTO_VENTA_EXPO (punto de venta de exportación)')
  }
  if (rec.faltantes.length) bloqueos.push(`Faltan datos del cliente: ${rec.faltantes.join(', ')}`)
  if (!items.length) bloqueos.push('La cotización no tiene ítems pendientes de facturar')

  let comprobanteSinResolver: PrefillFacturaExportacion['comprobanteSinResolver'] = null
  let cotizacion: CotizacionFex | null = null
  let cotizacionError: string | null = null
  if (pv) {
    const b = await lecturasFacturaExportacion.buscarBloqueante(pv)
    if (b) {
      comprobanteSinResolver = { ...b, numero: formatNroComprobante(pv, b.cbteNumero) }
      bloqueos.push(
        `Hay un comprobante de exportación ${b.estado} (Id ${b.fexId}, N° ${comprobanteSinResolver.numero}) sin resolver: ` +
          'reconciliarlo (scripts/arca-fex-reconciliar.ts) antes de emitir otro'
      )
    }
    try {
      cotizacion = await fexGetCotizacion(MONEDA_FEX.DOLAR)
    } catch (e) {
      cotizacionError = `No se pudo obtener la cotización oficial del dólar de ARCA: ${(e as Error).message}`
      bloqueos.push(cotizacionError)
    }
  }

  return {
    configurado,
    ambiente: cfg?.env ?? null,
    puntoVenta: pv,
    quote: {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      status: quote.status,
      currency: quote.currency,
      bonificacionPct,
      purchaseOrderNumber: quote.purchaseOrderNumber,
    },
    cliente: {
      id: quote.customer.id,
      nombre: limpiar(quote.customer.businessName) || limpiar(quote.customer.name),
      pais: rec.pais,
      iso: rec.iso,
      etiquetaIdFiscal: etiquetaIdFiscal(quote.customer.country),
      idImpositivo: limpiar(quote.customer.taxIdExterior) || null,
      cuitPais: rec.receptor?.cuitPais ?? null,
      tipoPersona: rec.tipoPersona,
      domicilio: rec.receptor?.domicilio ?? null,
      dstCmp: rec.receptor?.dstCmp ?? null,
    },
    faltantesCliente: rec.faltantes,
    advertenciasCliente: rec.advertencias,
    bloqueos,
    items,
    cotizacion,
    cotizacionError,
    comprobanteSinResolver,
    defaults: {
      regimen: 'EXPORTA_SIMPLE',
      incoterm: INCOTERM_DEFAULT,
      incotermLugar: limpiar(quote.customer.city).slice(0, 20),
      formaPago: formaPagoPorDefecto(quote.terms),
      cancelaEnMonedaExtranjera: true,
      idioma: IDIOMA.ESPANOL,
    },
    incoterms: INCOTERMS_EXPORTA_SIMPLE.map((codigo) => ({
      codigo,
      descripcion: INCOTERM_DESCRIPCION[codigo],
      sinFlete: INCOTERMS_SIN_FLETE.includes(codigo),
    })),
  }
}

// ---------------------------------------------------------------------------
// Armado del ExportacionInput (común a vista previa y emisión)
// ---------------------------------------------------------------------------

interface Preparado {
  quote: QuoteConItems
  input: ExportacionInput
  lineas: LineaExportacion[]
  cotizacion: CotizacionFex
}

async function preparar(quoteId: string, pedido: PedidoFacturaExportacion): Promise<Preparado> {
  if (!isFacturaExportacionConfigured()) {
    throw new FacturaExportacionError(
      'Factura E no configurada: faltan las variables ARCA_* o ARCA_PUNTO_VENTA_EXPO (punto de venta de exportación)',
      503
    )
  }
  const puntoVenta = getArcaConfig().puntoVentaExportacion!
  const quote = await cargarCotizacion(quoteId)
  const bloqueos = bloqueosCotizacion(quote)
  if (bloqueos.length) throw new FacturaExportacionError(bloqueos.join(' · '), esClienteExterior(quote.customer) ? 400 : 422)

  const errores: string[] = []
  const rec = receptorExportacion(quote.customer)
  if (rec.faltantes.length) errores.push(`Faltan datos del cliente: ${rec.faltantes.join(', ')}`)

  const { items, lineas, errores: erroresItems } = armarItemsExportacion(
    quoteItemsExportables(quote),
    pedido,
    Number(quote.bonification ?? 0) || 0
  )
  errores.push(...erroresItems)

  const base: Omit<ExportacionInput, 'receptor' | 'cotizacion'> = {
    clase: 'FACTURA',
    regimen: 'EXPORTA_SIMPLE',
    tipoExpo: TIPO_EXPO.BIENES,
    puntoVenta,
    moneda: 'USD',
    cancelaEnMonedaExtranjera: pedido.cancelaEnMonedaExtranjera !== false,
    items,
    formaPago: pedido.formaPago,
    incoterm: pedido.incoterm,
    incotermLugar: pedido.incotermLugar,
    idioma: IDIOMA.ESPANOL,
    obsComerciales: pedido.obsComerciales,
    exportaSimple: { desNumero: pedido.desNumero ?? '', fobUSD: Number(pedido.fobUSD) },
  }

  // Todas las validaciones de una vez y ANTES de consultar ARCA (con una
  // cotización provisoria: la real se pide después)
  if (rec.receptor && !erroresItems.length) {
    errores.push(...validarExportacion({ ...base, receptor: rec.receptor, cotizacion: 1 }))
  }
  errores.push(...(await erroresDesUsado(pedido.desNumero)))
  if (errores.length || !rec.receptor) throw new ExportacionValidacionError([...new Set(errores)])

  const cotizacion = await fexGetCotizacion(MONEDA_FEX.DOLAR)
  if (
    pedido.cotizacionEsperada !== undefined &&
    Math.abs(pedido.cotizacionEsperada - cotizacion.cotizacion) > 1e-6
  ) {
    throw new FacturaExportacionError(
      `La cotización oficial de ARCA cambió (${pedido.cotizacionEsperada} → ${cotizacion.cotizacion}, del ${cotizacion.fechaCotizacion}): revisá los importes y confirmá de nuevo`,
      409,
      { cotizacion }
    )
  }

  return { quote, input: { ...base, receptor: rec.receptor, cotizacion: cotizacion.cotizacion }, lineas, cotizacion }
}

// ---------------------------------------------------------------------------
// Vista previa (dryRun): el request exacto, sin llamar a FEXAuthorize
// ---------------------------------------------------------------------------

export interface VistaPreviaFacturaExportacion extends VistaPreviaExportacion {
  cotizacionArca: CotizacionFex
  lineas: LineaExportacion[]
  quoteNumber: string
}

export async function vistaPreviaFacturaExportacion(
  quoteId: string,
  pedido: PedidoFacturaExportacion
): Promise<VistaPreviaFacturaExportacion> {
  const prep = await preparar(quoteId, pedido)
  const vista = await vistaPreviaExportacion(prep.input, lecturasFacturaExportacion)
  return { ...vista, cotizacionArca: prep.cotizacion, lineas: prep.lineas, quoteNumber: prep.quote.quoteNumber }
}

// ---------------------------------------------------------------------------
// Emisión
// ---------------------------------------------------------------------------

export type ResultadoFacturaExportacion =
  | {
      ok: true
      /** null si ARCA autorizó pero el ERP no pudo guardar la Invoice (huérfana) */
      invoiceId: string | null
      huerfana: boolean
      fexId: number
      numeroInterno: string
      numeroFormateado: string
      cae: string
      caeVencimiento: Date
      totales: TotalesExportacion
      cotizacion: CotizacionFex
      reproceso: boolean
      recuperado: boolean
      observaciones: ArcaObservacion[]
      quoteNumber: string
      mensaje: string
    }
  | {
      ok: false
      estado: 'RECHAZADA' | 'INCIERTA'
      fexId: number
      numeroFormateado: string
      errores: ArcaObservacion[]
      mensaje: string
      quoteNumber: string
    }

// Una emisión de Factura E a la vez (carga → validación → ARCA → registro):
// el pendiente de la cotización y el DES se leen DENTRO del lock.
let colaFacturaE: Promise<unknown> = Promise.resolve()
function conLockFacturaE<T>(fn: () => Promise<T>): Promise<T> {
  const run = colaFacturaE.then(fn, fn)
  colaFacturaE = run.catch(() => undefined)
  return run
}

/**
 * Emite la Factura E de los ítems elegidos de una cotización y la registra.
 * Lanza ExportacionValidacionError (400), ExportacionBloqueadaError (409),
 * FacturaExportacionError (status propio) o errores de ARCA/DB ANTES de
 * llamar a FEXAuthorize. Un rechazo o un resultado incierto de ARCA vuelven
 * como { ok: false }.
 */
export function emitirFacturaExportacion(
  quoteId: string,
  pedido: PedidoFacturaExportacion,
  opts: { userId: string }
): Promise<ResultadoFacturaExportacion> {
  return conLockFacturaE(async () => {
    const prep = await preparar(quoteId, pedido)
    const cfg = getArcaConfig()
    const persistencia = persistenciaFacturaExportacion(
      { quoteId: prep.quote.id, customerId: prep.quote.customerId, userId: opts.userId, lineas: prep.lineas },
      { controlarNumeracion: cfg.env === 'prod' }
    )
    const res = await emitirExportacion(prep.input, persistencia)
    const quoteNumber = prep.quote.quoteNumber

    if (!res.ok) {
      return {
        ok: false,
        estado: res.estado,
        fexId: res.fexId,
        numeroFormateado: formatNroComprobante(res.puntoVenta, res.numero),
        errores: res.errores,
        mensaje: res.mensaje,
        quoteNumber,
      }
    }

    const aut: DatosAutorizacionRegistro = {
      cae: res.cae,
      caeVencimiento: res.caeVencimiento,
      fechaCbte: fechaYmdAR(res.fecha),
      motivosObs: res.motivosObs,
      reproceso: res.reproceso,
      recuperado: !!res.recuperado,
    }
    const comunes = {
      ok: true as const,
      fexId: res.fexId,
      numeroInterno: res.numeroInterno,
      numeroFormateado: res.numeroFormateado,
      cae: res.cae,
      caeVencimiento: res.caeVencimiento,
      totales: res.totales,
      cotizacion: prep.cotizacion,
      reproceso: res.reproceso,
      recuperado: !!res.recuperado,
      observaciones: res.observaciones,
      quoteNumber,
    }

    let invoiceId: string
    try {
      invoiceId = (await registrarInvoiceExportacion(res.fexId, aut)).invoiceId
    } catch (e) {
      // CAE obtenido pero el ERP no pudo guardar la Invoice: la fila queda
      // AUTORIZADA sin invoiceId y se registra después por script. NUNCA re-emitir.
      logger.error('[FEX_ORPHAN] Factura E autorizada en ARCA pero el ERP no pudo registrarla', {
        quoteId: prep.quote.id,
        quoteNumber,
        fexId: res.fexId,
        numero: res.numeroInterno,
        cae: res.cae,
        persistido: res.persistido,
        error: (e as Error).message,
      })
      if (!res.persistido) {
        // Último intento de dejar el CAE en el diario (si no, solo queda en el log)
        await persistencia
          .marcarAutorizada(res.fexId, { ...aut, response: null })
          .catch((err) => logger.error('[FEX_ORPHAN] Tampoco se pudo marcar AUTORIZADA', { fexId: res.fexId, error: (err as Error).message }))
      }
      return {
        ...comunes,
        invoiceId: null,
        huerfana: true,
        mensaje:
          `La Factura E ${res.numeroInterno} se emitió en ARCA (CAE ${res.cae}) pero el ERP no pudo registrarla. ` +
          `NO REINTENTES: se recupera con scripts/arca-fex-reconciliar.ts --apply (Id ${res.fexId}).`,
      }
    }

    // Comisiones del mes (en background, como generate-invoice) y PDF a SharePoint
    sincronizarComisionesDeQuote(prep.quote.id, { crearLiquidacion: true }).catch((err) =>
      logger.error('[COMISIONES_POST_BILLING] Error sincronizando comisiones (Factura E)', {
        quoteId: prep.quote.id,
        quoteNumber,
        error: (err as Error)?.message,
      })
    )
    archivarFacturaEnSharePointBg(invoiceId)

    return {
      ...comunes,
      invoiceId,
      huerfana: false,
      mensaje:
        `Factura E ${res.numeroInterno} emitida (CAE ${res.cae}). ` +
        'No se carga sola en Colppy: cargala a mano y pegá el id de Colppy en la factura.',
    }
  })
}

// ---------------------------------------------------------------------------
// Registro de la Invoice (emisión y reconciliación de huérfanas)
// ---------------------------------------------------------------------------

/**
 * Crea la Invoice (+ ítems, CotizacionFactura, cantidadFacturada y estado de
 * la cotización) de una FacturaExportacion autorizada y la vincula. Con `aut`
 * (recién emitida) también deja la fila AUTORIZADA con esos datos, aunque
 * marcarAutorizada hubiera fallado. Sin `aut` exige que la fila ya esté
 * AUTORIZADA con CAE (reconciliación). Idempotente: si ya tiene Invoice, la
 * devuelve; los unique de Invoice (número interno y PV+tipo+número) frenan
 * cualquier duplicado.
 */
export async function registrarInvoiceExportacion(
  fexId: number,
  aut?: DatosAutorizacionRegistro,
  opts: { ahora?: Date } = {}
): Promise<{ invoiceId: string; numeroInterno: string; creada: boolean }> {
  const fila = await prisma.facturaExportacion.findUnique({
    where: { fexId: BigInt(fexId) },
    include: { customer: { select: { paymentTerms: true } } },
  })
  if (!fila) throw new Error(`No existe la FacturaExportacion con Id ${fexId}`)
  const numeroInterno = numeroInternoExportacion(fila.cbteTipo, fila.puntoVenta, fila.cbteNumero)
  if (fila.invoiceId) return { invoiceId: fila.invoiceId, numeroInterno, creada: false }
  if (fila.cbteTipo !== FEX_CBTE.FACTURA_E) {
    throw new Error(`El registro de NC/ND E (tipo ${fila.cbteTipo}) todavía no está implementado (fase 2)`)
  }
  const datos: DatosAutorizacionRegistro | null =
    aut ??
    (fila.estado === ESTADO_FEX.AUTORIZADA && fila.cae && fila.caeVencimiento && fila.fechaCbte
      ? {
          cae: fila.cae,
          caeVencimiento: fila.caeVencimiento,
          fechaCbte: fila.fechaCbte,
          motivosObs: fila.motivosObs,
          reproceso: fila.reproceso,
          recuperado: fila.recuperado,
        }
      : null)
  if (!datos) throw new Error(`La FacturaExportacion Id ${fexId} no está AUTORIZADA con CAE (estado ${fila.estado})`)

  const cmp = fila.request as unknown as FexCmp
  const lineas = fila.lineas as unknown as LineaExportacion[]
  const ahora = opts.ahora ?? new Date()
  // Emitida hoy: fecha y hora reales; reconciliada otro día: la fecha del comprobante (12:00 AR)
  const issueDate = datos.fechaCbte === fechaYmdAR(ahora) ? ahora : fechaDesdeYmd(datos.fechaCbte)
  const total = Number(fila.totalUSD)
  const cotizacion = Number(fila.monedaCtz)
  const montos = montosComisionExportacion({ mercaderiaUSD: Number(fila.mercaderiaUSD) }, cotizacion)
  const qrUrl = qrUrlExportacion(cmp, { cae: datos.cae, fechaCbte: datos.fechaCbte, cuit: getArcaConfig().cuit })
  const lineasCotizacion = lineas.filter((l) => l.quoteItemId)

  const invoiceId = await prisma.$transaction(
    async (tx) => {
      const quote = fila.quoteId
        ? await tx.quote.findUnique({
            where: { id: fila.quoteId },
            select: {
              id: true,
              status: true,
              salesPersonId: true,
              items: {
                where: { isAlternative: false },
                select: {
                  id: true,
                  quantity: true,
                  cantidadFacturada: true,
                  invoiceItems: { select: { quantity: true, invoice: { select: { status: true, transactionType: true } } } },
                },
              },
            },
          })
        : null

      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: numeroInterno,
          invoiceType: 'E',
          transactionType: 'SALE',
          quoteId: fila.quoteId,
          customerId: fila.customerId,
          userId: quote?.salesPersonId || fila.createdById,
          status: 'AUTHORIZED',
          currency: 'USD',
          exchangeRate: cotizacion,
          subtotal: total,
          taxAmount: 0,
          discount: 0,
          total,
          balance: total,
          issueDate,
          dueDate: calcDueDate(issueDate, fila.customer.paymentTerms),
          notes: notasFacturaExportacion({
            numeroInterno,
            cae: datos.cae,
            emitidaEl: issueDate,
            cmp,
            manualUSD: Number(fila.manualUSD),
            recuperado: datos.recuperado,
            reproceso: datos.reproceso,
          }),
          cae: datos.cae,
          caeExpiration: datos.caeVencimiento,
          afipStatus: 'APPROVED',
          paymentStatus: 'UNPAID',
          emitidaPor: 'ARCA',
          pointOfSale: fila.puntoVenta,
          cbteTipo: fila.cbteTipo,
          cbteNumero: fila.cbteNumero,
          docTipo: null,
          docNro: fila.idImpositivo ?? fila.cuitPais,
          qrUrl,
          arcaObservaciones: datos.motivosObs,
          // v1: Caro la carga a mano en Colppy y pega el id (PATCH /api/facturas/[id]/colppy-id)
          colppySyncStatus: 'MANUAL',
          items: {
            create: lineas.map((l) => ({
              productId: l.productId,
              quoteItemId: l.quoteItemId,
              sku: l.codigo,
              description: l.descripcion,
              quantity: l.cantidad,
              unitPrice: l.precioUnitario,
              discount: l.descuentoPct,
              taxRate: 0,
              subtotal: l.subtotal,
            })),
          },
        },
      })

      await tx.facturaExportacion.update({
        where: { id: fila.id },
        data: {
          invoiceId: invoice.id,
          ...(aut
            ? {
                estado: ESTADO_FEX.AUTORIZADA,
                numeroOcupado: fila.cbteNumero,
                cae: aut.cae,
                caeVencimiento: aut.caeVencimiento,
                fechaCbte: aut.fechaCbte,
                motivosObs: aut.motivosObs,
                reproceso: aut.reproceso,
                recuperado: aut.recuperado,
              }
            : {}),
        },
      })

      if (quote) {
        // Comisión: CotizacionFactura EMITIDA con SOLO la mercadería
        await tx.cotizacionFactura.create({
          data: {
            cotizacionId: quote.id,
            invoiceId: invoice.id,
            colppyInvoiceId: null,
            numeroFactura: numeroInterno,
            fecha: issueDate,
            montoUSD: montos.montoUSD,
            montoARS: montos.montoARS,
            tipoCambio: montos.tipoCambio,
            estado: 'EMITIDA',
            createdById: fila.createdById,
            items: {
              create: lineasCotizacion.map((l) => ({
                cotizacionItemId: l.quoteItemId!,
                cantidad: l.cantidad,
                precioUnitario: l.precioUnitario,
                subtotal: l.subtotal,
              })),
            },
          },
        })

        const enviadoPorItem = new Map<string, number>()
        for (const l of lineasCotizacion) {
          enviadoPorItem.set(l.quoteItemId!, (enviadoPorItem.get(l.quoteItemId!) ?? 0) + l.cantidad)
        }
        if (enviadoPorItem.size) {
          const values = Array.from(enviadoPorItem.entries()).map(([id, qty]) => Prisma.sql`(${id}, ${qty}::numeric)`)
          await tx.$executeRaw`
            UPDATE quote_items AS qi
            SET "cantidadFacturada" = qi."cantidadFacturada" + v.qty,
                "updatedAt" = NOW()
            FROM (VALUES ${Prisma.join(values)}) AS v(id, qty)
            WHERE qi.id = v.id
          `
        }

        // Pendiente calculado ANTES de crear la Invoice + lo facturado ahora
        const completa = quote.items.every(
          (item) => item.quantity - cantidadPendienteQuoteItem(item) + (enviadoPorItem.get(item.id) ?? 0) >= item.quantity
        )
        const toStatus = completa ? 'CONVERTED' : 'FACTURADA_PARCIAL'
        await tx.quote.update({
          where: { id: quote.id },
          data: { status: toStatus, statusUpdatedAt: ahora, statusUpdatedBy: fila.createdById },
        })
        await tx.quoteStatusHistory.create({
          data: {
            quoteId: quote.id,
            fromStatus: quote.status,
            toStatus,
            changedBy: fila.createdById,
            notes:
              `${completa ? 'Facturación completa' : 'Facturación parcial'} con Factura E ${numeroInterno} ` +
              `(exportación, ARCA WSFEX) CAE ${datos.cae} (${lineasCotizacion.length} ítems)`,
          },
        })
      }
      return invoice.id
    },
    { maxWait: 10000, timeout: 60000 }
  )

  logger.info(`[WSFEX] Factura E ${numeroInterno} registrada (invoice ${invoiceId}, Id ${fexId})`)
  return { invoiceId, numeroInterno, creada: true }
}

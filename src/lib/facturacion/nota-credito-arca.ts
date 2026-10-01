/**
 * Nota de crédito de venta emitida por el ERP (ARCA WSFE) sobre una factura
 * que también emitió el ERP.
 *
 * Flujo:
 *   1. Emite la NC en ARCA asociada a la factura (misma letra, moneda y TC).
 *   2. Persiste la NC como Invoice (transactionType CREDIT_NOTE, relatedInvoiceId).
 *   3. NC total: anula la factura en el ERP (status CANCELLED), devuelve las
 *      cantidades a la cotización (cantidadFacturada) y reabre la cotización si
 *      corresponde. Comisiones: si la factura es del mes de la NC se marca
 *      ANULADA; si es de un mes anterior resta con una fila negativa en el mes
 *      de la NC. NC por unidades: ver nc-unidades.ts (stock, cotización y
 *      comisión de las unidades devueltas). NC por importe: solo saldo.
 *   4. Registra la NC en Colppy como Aprobada no-electrónica (idTipoComprobante
 *      5) para que mueva CC/asiento/stock. Si Colppy falla, la NC queda
 *      PENDIENTE con su payload para reintentar (mismo mecanismo que facturas).
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { archivarFacturaEnSharePointBg } from '@/lib/sharepoint/facturas-emitidas'
import {
  colppyCreateInvoice,
  getCachedColppySession,
  invalidateColppySessionCache,
  ColppySessionExpiredError,
  type ColppyInvoicePayload,
} from '@/lib/colppy'
import { getArcaConfig } from '@/lib/arca/config'
import { emitirComprobante, receptorDesdeCondicion, type LetraComprobante } from '@/lib/arca/emitir'
import { buildQrUrl, toCbteFch } from '@/lib/arca/wsfe'
import { sincronizarComisionesDeQuote } from '@/lib/comisiones/liquidacion'
import { signoCantidad } from '@/lib/facturacion/cantidades'
import {
  acreditadoVacio,
  calcularNcImporte,
  calcularNcUnidades,
  claveLinea,
  lineasAcreditables,
  prepararContextoNc,
  vincularLineasFactura,
  type Acreditado,
  type CalculoNcUnidades,
  type ContextoNc,
  type ItemFacturaVinculable,
  type LineaAcreditable,
  type SeleccionUnidades,
  type VinculoLinea,
} from '@/lib/facturacion/nc-unidades'

export type ModoNotaCredito = 'TOTAL' | 'IMPORTE' | 'UNIDADES'

export interface EmitirNotaCreditoOpts {
  userId: string
  motivo?: string
  /**
   * Modo elegido. Si se omite: UNIDADES con `unidades`, IMPORTE con
   * `netoParcial`, TOTAL sin ninguno. Nunca se pasa de IMPORTE a TOTAL; de
   * UNIDADES a TOTAL solo si devuelve todo y no hubo NC antes.
   */
  modo?: ModoNotaCredito
  /**
   * IMPORTE: neto de la NC (ajuste/bonificación: solo saldo y total, no
   * devuelve stock ni toca la cotización). Hasta el neto pendiente de acreditar.
   */
  netoParcial?: number
  /**
   * Devolución por unidades: [{ index (línea de la factura), cantidad }]. El
   * importe sale de las líneas de la factura, la NC devuelve el stock en
   * Colppy, las unidades vuelven a quedar pendientes en la cotización y la
   * comisión baja en el mes de la NC (CotizacionFactura negativa).
   */
  unidades?: SeleccionUnidades[]
}

export interface NotaCreditoResult {
  ok: true
  invoiceId: string
  numero: string
  cae: string
  caeVencimiento: Date
  total: number
  esTotal: boolean
  modo: ModoNotaCredito
  /** Avisos para el usuario (p. ej. líneas que no se pudieron vincular a la cotización) */
  advertencias: string[]
  colppyPendiente: boolean
  /** NC sobre FCE: quedó como BORRADOR en Colppy (tildar FCE y aprobar). */
  colppyBorradorFce: boolean
  colppyId: string | null
}

export class NotaCreditoError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'NotaCreditoError'
  }
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

type NcPrevia = {
  transactionType: string
  status: string
  subtotal: unknown
  taxAmount: unknown
  items: Array<{ sku: string | null; description: string | null; quantity: unknown; lineaFactura: number | null }>
}

/** Cantidades ya devueltas en NC por unidades anteriores (por índice de línea; las viejas sin índice, por código+descripción). */
function acreditadoPorLinea(ncs: NcPrevia[]): Acreditado {
  const acc = acreditadoVacio()
  for (const nc of ncs) {
    if (nc.transactionType !== 'CREDIT_NOTE' || nc.status === 'CANCELLED') continue
    for (const it of nc.items) {
      if (it.lineaFactura != null) {
        acc.porIndice.set(it.lineaFactura, (acc.porIndice.get(it.lineaFactura) ?? 0) + Number(it.quantity))
      } else {
        const k = claveLinea(it.sku, it.description)
        acc.porClave.set(k, (acc.porClave.get(k) ?? 0) + Number(it.quantity))
      }
    }
  }
  return acc
}

const SELECT_NC_PREVIA = {
  id: true,
  transactionType: true,
  status: true,
  total: true,
  subtotal: true,
  taxAmount: true,
  items: { select: { sku: true, description: true, quantity: true, lineaFactura: true } },
} as const

/** Ítems de la factura con lo necesario para vincular cada línea a la cotización (en orden de creación). */
const SELECT_ITEMS_VINCULO = {
  orderBy: { id: 'asc' as const },
  select: {
    id: true,
    quoteItemId: true,
    quantity: true,
    description: true,
    unitPrice: true,
    subtotal: true,
    productId: true,
    sku: true,
    comment: true,
    product: { select: { sku: true, name: true } },
    quoteItem: {
      select: {
        manualSku: true,
        description: true,
        product: { select: { sku: true, name: true } },
        additionals: { select: { description: true, product: { select: { sku: true, name: true } } } },
      },
    },
  },
}

type ItemConVinculo = {
  id: string
  quoteItemId: string | null
  quantity: unknown
  description: string | null
  sku: string | null
  product: { sku: string; name: string } | null
  quoteItem: {
    manualSku: string | null
    description: string | null
    product: { sku: string; name: string } | null
    additionals: Array<{ description: string | null; product: { sku: string; name: string } | null }>
  } | null
}

function vincular(payload: ColppyInvoicePayload, items: ItemConVinculo[]): VinculoLinea[] {
  const vinculables: ItemFacturaVinculable[] = items.map((it) => ({
    id: it.id,
    quoteItemId: it.quoteItemId,
    quantity: Number(it.quantity),
    codigos: [it.sku, it.product?.sku, it.quoteItem?.product?.sku, it.quoteItem?.manualSku],
    nombres: [it.description, it.product?.name, it.quoteItem?.description, it.quoteItem?.product?.name],
    adicionales: (it.quoteItem?.additionals ?? []).map((a) => ({
      codigos: [a.product?.sku],
      nombres: [a.product?.name, a.description],
    })),
  }))
  return vincularLineasFactura(payload.items, vinculables)
}

/** Líneas acreditables con el ajuste por NC previas y el vínculo con la cotización. */
function armarLineas(
  payload: ColppyInvoicePayload,
  factura: { neto: number; iva: number; tieneCotizacion: boolean },
  ncs: NcPrevia[],
  items: ItemConVinculo[]
): { lineas: LineaAcreditable[]; contexto: ContextoNc; vinculos: VinculoLinea[] } {
  const vigentes = ncs.filter((r) => r.transactionType === 'CREDIT_NOTE' && r.status !== 'CANCELLED')
  const base = lineasAcreditables(payload, acreditadoPorLinea(vigentes))
  const { lineas, contexto } = prepararContextoNc(
    base,
    factura,
    vigentes.map((n) => ({
      subtotal: Number(n.subtotal),
      taxAmount: Number(n.taxAmount),
      // NC por importe: sin líneas devueltas (bonificación sobre el precio)
      porImporte: !n.items.some((it) => it.lineaFactura != null),
    }))
  )
  const vinculos = vincular(payload, items)
  for (const l of lineas) {
    const v = vinculos[l.index]
    l.vinculo = !factura.tieneCotizacion ? null : !v || !v.quoteItemId ? 'SIN_VINCULO' : v.adicional ? 'ADICIONAL' : 'COTIZACION'
    l.adicionalDe = v?.adicional ? v.principal : null
  }
  return { lineas, contexto, vinculos }
}

/**
 * Líneas de la factura para una NC por unidades, con lo ya devuelto, lo
 * disponible y el contexto para calcular los importes igual que el servidor.
 * null si la factura no tiene las líneas de Colppy guardadas.
 */
export async function obtenerLineasNcUnidades(invoiceId: string): Promise<{
  lineas: LineaAcreditable[]
  contexto: ContextoNc
  moneda: string
  letra: string
  pendienteAcreditar: number
} | null> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      colppyPayload: true,
      currency: true,
      invoiceType: true,
      subtotal: true,
      taxAmount: true,
      total: true,
      quoteId: true,
      items: SELECT_ITEMS_VINCULO,
      relatedInvoices: { select: SELECT_NC_PREVIA },
    },
  })
  const payload = (inv?.colppyPayload ?? null) as ColppyInvoicePayload | null
  if (!inv || !payload || !Array.isArray(payload.items) || !payload.items.length) return null
  const { lineas, contexto } = armarLineas(
    payload,
    { neto: Number(inv.subtotal), iva: Number(inv.taxAmount), tieneCotizacion: !!inv.quoteId },
    inv.relatedInvoices,
    inv.items
  )
  const ncPrevias = inv.relatedInvoices
    .filter((r) => r.transactionType === 'CREDIT_NOTE' && r.status !== 'CANCELLED')
    .reduce((s, r) => s + Number(r.total), 0)
  return {
    lineas,
    contexto,
    moneda: inv.currency,
    letra: inv.invoiceType,
    pendienteAcreditar: r2(Number(inv.total) - ncPrevias),
  }
}

const ncEnCurso = new Set<string>()

export async function emitirNotaCredito(invoiceId: string, opts: EmitirNotaCreditoOpts): Promise<NotaCreditoResult> {
  if (ncEnCurso.has(invoiceId)) {
    throw new NotaCreditoError('Ya se está emitiendo una nota de crédito sobre esta factura; esperá unos segundos', 409)
  }
  ncEnCurso.add(invoiceId)
  try {
    return await emitirNotaCreditoInterno(invoiceId, opts)
  } finally {
    ncEnCurso.delete(invoiceId)
  }
}

async function emitirNotaCreditoInterno(invoiceId: string, opts: EmitirNotaCreditoOpts): Promise<NotaCreditoResult> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: { select: { id: true, name: true, cuit: true, taxCondition: true } },
      items: SELECT_ITEMS_VINCULO,
      relatedInvoices: { select: SELECT_NC_PREVIA },
      cotizacionFactura: {
        select: { id: true, estado: true, fecha: true, montoUSD: true, montoARS: true, tipoCambio: true, items: { select: { cotizacionItemId: true, cantidad: true, precioUnitario: true, subtotal: true } } },
      },
      quote: { select: { id: true, status: true, quoteNumber: true } },
    },
  })
  if (!inv) throw new NotaCreditoError('Factura no encontrada', 404)
  if (inv.emitidaPor !== 'ARCA' || !inv.cae || !inv.pointOfSale || !inv.cbteTipo || !inv.cbteNumero) {
    throw new NotaCreditoError('Solo se pueden emitir notas de crédito sobre facturas emitidas por el ERP (ARCA)')
  }
  if (inv.transactionType !== 'SALE') throw new NotaCreditoError('El comprobante no es una factura de venta')
  if (inv.status === 'CANCELLED') throw new NotaCreditoError('La factura ya está anulada')

  const netoFactura = Number(inv.subtotal)
  const ivaFactura = Number(inv.taxAmount)
  const totalFactura = Number(inv.total)
  const ncPrevias = inv.relatedInvoices
    .filter((r) => r.transactionType === 'CREDIT_NOTE' && r.status !== 'CANCELLED')
    .reduce((s, r) => s + Number(r.total), 0)
  if (ncPrevias >= totalFactura - 0.01) throw new NotaCreditoError('La factura ya fue acreditada en su totalidad')

  const facturaPayload = (inv.colppyPayload ?? null) as ColppyInvoicePayload | null
  const ncsVigentes = inv.relatedInvoices.filter((r) => r.transactionType === 'CREDIT_NOTE' && r.status !== 'CANCELLED')

  // Modo e importes de la NC. El modo lo elige el usuario: un ajuste por
  // importe nunca se convierte en NC total.
  const modoPedido: ModoNotaCredito =
    opts.modo ?? (opts.unidades !== undefined ? 'UNIDADES' : opts.netoParcial !== undefined ? 'IMPORTE' : 'TOTAL')
  let modo: ModoNotaCredito
  let calc: CalculoNcUnidades | null = null
  let vinculos: VinculoLinea[] = []
  let neto: number
  let iva: number
  if (modoPedido === 'UNIDADES') {
    if (!Array.isArray(opts.unidades) || !opts.unidades.length) throw new NotaCreditoError('Indicá cuántas unidades se devuelven')
    if (!facturaPayload || !Array.isArray(facturaPayload.items) || !facturaPayload.items.length) {
      throw new NotaCreditoError('La factura no tiene el detalle de líneas guardado: usá el ajuste por importe')
    }
    const armado = armarLineas(facturaPayload, { neto: netoFactura, iva: ivaFactura, tieneCotizacion: !!inv.quote }, inv.relatedInvoices, inv.items)
    vinculos = armado.vinculos
    try {
      calc = calcularNcUnidades(facturaPayload, armado.lineas, opts.unidades, armado.contexto)
    } catch (e) {
      throw new NotaCreditoError((e as Error).message)
    }
    // Devuelve todo y no hubo NC antes: es una NC total (anula la factura).
    // Si devuelve lo último que quedaba, calc ya trae el remanente exacto.
    modo = calc.devuelveTodo ? 'TOTAL' : 'UNIDADES'
    neto = calc.neto
    iva = calc.iva
  } else if (modoPedido === 'IMPORTE') {
    try {
      const imp = calcularNcImporte(Number(opts.netoParcial), {
        netoPendiente: r2(netoFactura - ncsVigentes.reduce((acc, r) => acc + Number(r.subtotal), 0)),
        ivaPendiente: r2(ivaFactura - ncsVigentes.reduce((acc, r) => acc + Number(r.taxAmount), 0)),
        hayNcPrevias: ncsVigentes.length > 0,
      })
      neto = imp.neto
      iva = imp.iva
    } catch (e) {
      throw new NotaCreditoError((e as Error).message)
    }
    modo = 'IMPORTE'
  } else {
    modo = 'TOTAL'
    neto = r2(netoFactura)
    iva = r2(ivaFactura)
  }
  const esTotal = modo === 'TOTAL'
  if (esTotal) {
    neto = r2(netoFactura)
    iva = r2(ivaFactura)
    if (ncsVigentes.length > 0) {
      throw new NotaCreditoError('La factura ya tiene notas de crédito: para el resto usá la devolución por unidades o el ajuste por importe')
    }
  }
  const total = r2(neto + iva)
  if (!(neto > 0)) throw new NotaCreditoError('El importe de la nota de crédito tiene que ser mayor a cero')
  if (!esTotal && ncPrevias + total > totalFactura + 0.01) {
    throw new NotaCreditoError(`El importe supera lo pendiente de acreditar (${r2(totalFactura - ncPrevias)})`)
  }

  // Receptor: el mismo de la factura
  const letra = (inv.invoiceType === 'A' || inv.invoiceType === 'B' || inv.invoiceType === 'C' ? inv.invoiceType : 'B') as LetraComprobante
  // NC sobre una FCE MiPyME (201/206) debe salir como NC FCE (203/208) con
  // Opcional 22. Anulación 'S' solo procede si el comprador rechazó la FCE en
  // el registro (error 10154 si no); el camino normal es el ajuste ('N').
  const esFce = inv.cbteTipo === 201 || inv.cbteTipo === 206
  const { receptor } = receptorDesdeCondicion(inv.customer.taxCondition, inv.docNro || inv.customer.cuit)
  if (inv.docTipo) receptor.docTipo = inv.docTipo
  if (inv.docNro) receptor.docNro = inv.docNro

  const esUsd = inv.currency === 'USD'
  const cotizacion = esUsd ? Number(inv.exchangeRate ?? 0) : 1
  if (esUsd && !(cotizacion > 0)) throw new NotaCreditoError('La factura en USD no tiene tipo de cambio registrado')
  const cfg = getArcaConfig()

  // 1. Emitir en ARCA
  const em = await emitirComprobante({
    clase: 'NOTA_CREDITO',
    letra,
    fce: esFce ? { anulacion: 'N' } : undefined,
    fecha: new Date(),
    receptor,
    moneda: esUsd ? 'USD' : 'ARS',
    cotizacion: esUsd ? cotizacion : undefined,
    cancelaEnMonedaExtranjera: false,
    importes: {
      netoGravado: neto,
      netoNoGravado: 0,
      exento: 0,
      iva: [{ alicuota: '21', baseImponible: neto, importe: iva }],
      total,
    },
    asociados: [
      {
        Tipo: inv.cbteTipo,
        PtoVta: inv.pointOfSale,
        Nro: inv.cbteNumero,
        Cuit: cfg.cuit,
        CbteFch: toCbteFch(inv.issueDate),
      },
    ],
  })
  if (!em.ok) {
    throw new NotaCreditoError(`ARCA rechazó la nota de crédito: ${em.mensaje}`, 422)
  }

  const qrUrl = buildQrUrl({
    fecha: em.fecha,
    cuit: cfg.cuit,
    ptoVta: em.puntoVenta,
    tipoCmp: em.cbteTipo,
    nroCmp: em.numero,
    importe: total,
    moneda: esUsd ? 'DOL' : 'PES',
    ctz: cotizacion,
    tipoDocRec: receptor.docTipo,
    nroDocRec: receptor.docNro,
    codAut: em.cae,
  })
  // La NC FCE (203/208) tiene numeración propia por cbteTipo → prefijo distinto
  const numeroErp = `NC${esFce ? 'FCE' : ''}${letra}-${em.numeroFormateado}`
  const now = new Date()
  const motivo = (opts.motivo || '').trim()

  // Payload Colppy (NC Aprobada no electrónica, misma mecánica que la factura)
  const fmtColppy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
  const colppyPayload: ColppyInvoicePayload | null = facturaPayload
    ? {
        ...facturaPayload,
        descripcion: `NC ${motivo ? motivo + ' ' : ''}s/Fact ${inv.invoiceNumber} - CAE ${em.cae}`.slice(0, 100),
        fechaFactura: fmtColppy(now),
        fechaVto: fmtColppy(now),
        estado: 'Aprobada',
        claseComprobante: 'NOTA_CREDITO',
        // NC sobre FCE (203/208): NCV MiPyme en Colppy
        mipyme: em.cbteTipo >= 201,
        cae: em.cae,
        nroFactura1: String(em.puntoVenta).padStart(4, '0'),
        nroFactura2: String(em.numero).padStart(8, '0'),
        netoGravado: neto,
        netoNoGravado: 0,
        totalIVA: iva,
        totalFactura: total,
        // NC total: mismas líneas (devuelve stock). Por unidades: las líneas
        // devueltas con su artículo (devuelve ese stock). Por importe: una
        // línea de ajuste sin ítem de inventario.
        items: esTotal
          ? facturaPayload.items
          : calc
          ? calc.lineasColppy
          : [
              {
                idItem: 0,
                minimo: '',
                tipoItem: '',
                codigo: '',
                Descripcion: `Nota de crédito s/Fact ${inv.invoiceNumber}${motivo ? ` - ${motivo}` : ''}`,
                ImporteUnitario: letra === 'A' ? neto : total,
                subtotal: letra === 'A' ? neto : total,
                IVA: 21,
                Cantidad: 1,
                unidadMedida: 'Un',
                Comentario: motivo || '',
                porcDesc: 0,
                idPlanCuenta: 'Ventas',
                ccosto1: '',
                ccosto2: '',
                almacen: '',
                editable: false,
              },
            ],
      }
    : null

  // Por unidades: cada línea devuelta va al ítem de la factura (y de la
  // cotización) que la generó (vincularLineasFactura). Solo las líneas
  // principales devuelven unidades a la cotización: un adicional va dentro de
  // la unidad de su ítem principal, y las manuales no tienen ítem.
  const devueltas = (calc?.detalle ?? []).map((d) => {
    const v = vinculos[d.linea.index] ?? null
    const invoiceItem = v ? inv.items.find((i) => i.id === v.invoiceItemId) ?? null : null
    return { ...d, invoiceItem, adicional: !!v?.adicional }
  })
  const advertencias: string[] = []
  // Una unidad de la cotización = la línea principal + sus adicionales: solo
  // vuelve a pendiente si se devuelve completa (si no, al re-facturarla se
  // cobraría de nuevo el adicional que el cliente se quedó).
  const devueltasPorQuoteItem = new Map<string, number>()
  for (const d of devueltas) {
    const qi = d.adicional ? null : d.invoiceItem?.quoteItemId
    if (!qi) continue
    const adicionales = vinculos
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => v?.adicional && v.principal === d.linea.index)
      .map(({ i }) => calc?.cantidades.get(i) ?? 0)
    const completas = Math.min(d.cantidad, ...adicionales)
    if (completas < d.cantidad) {
      advertencias.push(
        `${d.linea.codigo || d.linea.descripcion.slice(0, 40)}: ${r2(d.cantidad - completas)} unidad(es) se devolvieron sin sus adicionales y no vuelven a quedar pendientes en la cotización.`
      )
    }
    if (completas > 0) devueltasPorQuoteItem.set(qi, (devueltasPorQuoteItem.get(qi) ?? 0) + completas)
  }
  const detalleDevolucion = devueltas.map((d) => `${d.cantidad} × ${d.linea.codigo || d.linea.descripcion.slice(0, 40)}`).join(', ')
  if (modo === 'UNIDADES' && inv.quote) {
    const sinVinculo = devueltas.filter((d) => !d.adicional && !d.invoiceItem?.quoteItemId)
    if (sinVinculo.length) {
      advertencias.push(
        `No se pudo vincular con la cotización: ${sinVinculo.map((d) => d.linea.codigo || d.linea.descripcion.slice(0, 40)).join(', ')}. ` +
          'Esas unidades no vuelven a quedar pendientes en la cotización (el stock en Colppy sí se devuelve).'
      )
    }
  }

  // Comisiones: ¿la fila de la factura todavía cuenta? ¿La NC resta con una
  // fila negativa en su mes? (devolución por unidades, o NC total de una
  // factura de un mes anterior). Si la fila ya no cuenta (ANULADA), nada.
  const cfCuenta = !!inv.cotizacionFactura && !['ANULADA', 'ERROR_GUARDADO'].includes(inv.cotizacionFactura.estado)
  const cfMesAnterior =
    !!inv.cotizacionFactura &&
    (inv.cotizacionFactura.fecha.getFullYear() !== now.getFullYear() || inv.cotizacionFactura.fecha.getMonth() !== now.getMonth())
  const filaNegativa = !!inv.quote && cfCuenta && netoFactura > 0 && (modo === 'UNIDADES' || (esTotal && cfMesAnterior))

  // 2./3. Persistir NC + efectos sobre la factura/cotización
  const ncId = await prisma.$transaction(async (tx) => {
    /**
     * Estado de la cotización según lo facturado NETO (facturas vigentes menos
     * devoluciones): nada → Aceptada; algo → Facturada parcial. Una factura
     * devuelta entera por unidades sigue vigente pero ya no cuenta.
     */
    const actualizarEstadoCotizacion = async (tx2: Prisma.TransactionClient, nota: string) => {
      if (!inv.quote || (inv.quote.status !== 'CONVERTED' && inv.quote.status !== 'FACTURADA_PARCIAL')) return
      const itemsCoti = await tx2.quoteItem.findMany({
        where: { quoteId: inv.quote.id, isAlternative: false },
        select: {
          cantidadFacturada: true,
          invoiceItems: { select: { quantity: true, invoice: { select: { status: true, transactionType: true } } } },
        },
      })
      const quedaFacturado = itemsCoti.some((it) => {
        const porFacturas = it.invoiceItems
          .filter((ii) => ii.invoice.status !== 'CANCELLED')
          .reduce((s, ii) => s + signoCantidad(ii.invoice) * Number(ii.quantity), 0)
        return Math.max(porFacturas, Number(it.cantidadFacturada)) > 0
      })
      const nuevoEstado = quedaFacturado ? 'FACTURADA_PARCIAL' : 'ACCEPTED'
      if (nuevoEstado === inv.quote.status) return
      await tx2.quote.update({
        where: { id: inv.quote.id },
        data: { status: nuevoEstado, statusUpdatedAt: now, statusUpdatedBy: opts.userId },
      })
      await tx2.quoteStatusHistory.create({
        data: { quoteId: inv.quote.id, fromStatus: inv.quote.status, toStatus: nuevoEstado, changedBy: opts.userId, notes: nota },
      })
    }

    const nc = await tx.invoice.create({
      data: {
        invoiceNumber: numeroErp,
        invoiceType: letra,
        transactionType: 'CREDIT_NOTE',
        customerId: inv.customerId,
        quoteId: inv.quoteId,
        userId: opts.userId,
        status: 'AUTHORIZED',
        currency: inv.currency,
        exchangeRate: inv.exchangeRate,
        subtotal: neto,
        taxAmount: iva,
        discount: 0,
        total,
        balance: 0,
        issueDate: now,
        dueDate: now,
        paymentStatus: 'PAID',
        afipStatus: 'APPROVED',
        cae: em.cae,
        caeExpiration: em.caeVencimiento,
        emitidaPor: 'ARCA',
        pointOfSale: em.puntoVenta,
        cbteTipo: em.cbteTipo,
        cbteNumero: em.numero,
        docTipo: receptor.docTipo,
        docNro: receptor.docNro,
        qrUrl,
        arcaObservaciones: em.observaciones.length ? em.observaciones.map((o) => `[${o.Code}] ${o.Msg}`).join(' · ') : null,
        relatedInvoiceId: inv.id,
        notes: `Nota de crédito ${esTotal ? 'TOTAL' : modo === 'UNIDADES' ? `POR UNIDADES (devolución: ${detalleDevolucion})` : 'PARCIAL'} s/ ${inv.invoiceNumber}${motivo ? ` — ${motivo}` : ''}. CAE ${em.cae}.`,
        colppySyncStatus: colppyPayload ? 'PENDIENTE' : null,
        colppyPayload: colppyPayload ? (JSON.parse(JSON.stringify(colppyPayload)) as Prisma.InputJsonValue) : Prisma.JsonNull,
        items: esTotal
          ? {
              create: inv.items.map((it) => ({
                quoteItemId: null, // no vincular a la cotización: no es facturación
                productId: it.productId,
                sku: it.sku,
                description: it.description,
                comment: it.comment,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                discount: 0,
                taxRate: 21,
                subtotal: it.subtotal,
              })),
            }
          : modo === 'UNIDADES'
          ? {
              // quoteItemId en las devoluciones: restan en lo facturado de la
              // cotización (signoCantidad) → las unidades vuelven a pendientes
              create: devueltas.map((d) => ({
                quoteItemId: d.adicional ? null : d.invoiceItem?.quoteItemId ?? null,
                productId: d.adicional ? null : d.invoiceItem?.productId ?? null,
                lineaFactura: d.linea.index,
                sku: d.linea.codigo,
                description: d.linea.descripcion,
                quantity: d.cantidad,
                unitPrice: r2(d.linea.netoUnitario),
                discount: 0,
                taxRate: 21,
                subtotal: d.neto,
              })),
            }
          : undefined,
      },
    })

    if (esTotal) {
      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          status: 'CANCELLED',
          balance: 0,
          paymentStatus: 'PAID',
          notes: `${inv.notes || ''}\nANULADA por NC ${numeroErp} (CAE ${em.cae}) el ${now.toLocaleString('es-AR')}${motivo ? ` — ${motivo}` : ''}`.trim(),
        },
      })
      // Comisiones: factura del mismo mes que la NC → deja de contar
      // (ANULADA). De un mes anterior (que puede estar cerrado y pagado) → la
      // factura queda en su mes y la NC resta en el mes actual (fila negativa
      // más abajo, igual que una devolución por unidades).
      if (inv.cotizacionFactura && cfCuenta && !filaNegativa) {
        await tx.cotizacionFactura.update({
          where: { id: inv.cotizacionFactura.id },
          data: { estado: 'ANULADA', errorMessage: `NC ${numeroErp}${motivo ? ` — ${motivo}` : ''}` },
        })
      }
      // Devolver cantidades a la cotización para que se puedan re-facturar
      const porItem = new Map<string, number>()
      for (const it of inv.items) {
        if (!it.quoteItemId) continue
        porItem.set(it.quoteItemId, (porItem.get(it.quoteItemId) || 0) + Number(it.quantity))
      }
      if (porItem.size > 0) {
        const values = Array.from(porItem.entries()).map(([id, qty]) => Prisma.sql`(${id}, ${qty}::numeric)`)
        await tx.$executeRaw`
          UPDATE quote_items AS qi
          SET "cantidadFacturada" = GREATEST(qi."cantidadFacturada" - v.qty, 0),
              "updatedAt" = NOW()
          FROM (VALUES ${Prisma.join(values)}) AS v(id, qty)
          WHERE qi.id = v.id
        `
      }
      // Reabrir la cotización si estaba facturada
      await actualizarEstadoCotizacion(tx, `Factura ${inv.invoiceNumber} anulada por NC ${numeroErp}${motivo ? ` — ${motivo}` : ''}`)
    } else {
      await tx.invoice.update({
        where: { id: inv.id },
        data: { balance: Math.max(0, r2(Number(inv.balance) - total)) },
      })
    }

    if (modo === 'UNIDADES' && devueltasPorQuoteItem.size > 0) {
      // Unidades devueltas → vuelven a quedar pendientes de facturar
      const values = Array.from(devueltasPorQuoteItem.entries()).map(([id, qty]) => Prisma.sql`(${id}, ${qty}::numeric)`)
      await tx.$executeRaw`
        UPDATE quote_items AS qi
        SET "cantidadFacturada" = GREATEST(qi."cantidadFacturada" - v.qty, 0),
            "updatedAt" = NOW()
        FROM (VALUES ${Prisma.join(values)}) AS v(id, qty)
        WHERE qi.id = v.id
      `
      await actualizarEstadoCotizacion(
        tx,
        `Devolución por NC ${numeroErp} (${detalleDevolucion})${motivo ? ` — ${motivo}` : ''}: unidades pendientes de nuevo`
      )
    }

    // Comisiones: la devolución (o la NC total de una factura de un mes
    // anterior) resta en el mes de la NC con una fila negativa, a precio de
    // factura. La fila original no se toca: sirve aunque su mes ya esté cerrado.
    const cf = inv.cotizacionFactura
    if (filaNegativa && inv.quote && cf) {
      const proporcion = esTotal ? 1 : Math.min(1, (calc?.netoFactura ?? neto) / netoFactura)
      const precioPorItem = new Map(cf.items.map((i) => [i.cotizacionItemId, Number(i.precioUnitario)]))
      const itemsNegativos = esTotal
        ? cf.items.map((i) => ({
            cotizacionItemId: i.cotizacionItemId,
            cantidad: -Number(i.cantidad),
            precioUnitario: Number(i.precioUnitario),
            subtotal: -Number(i.subtotal),
          }))
        : Array.from(devueltasPorQuoteItem.entries())
            .filter(([qi]) => precioPorItem.has(qi))
            .map(([qi, qty]) => ({
              cotizacionItemId: qi,
              cantidad: -qty,
              precioUnitario: precioPorItem.get(qi)!,
              subtotal: -r2(precioPorItem.get(qi)! * qty),
            }))
      await tx.cotizacionFactura.create({
        data: {
          cotizacionId: inv.quote.id,
          invoiceId: nc.id,
          numeroFactura: numeroErp,
          fecha: now,
          montoUSD: -r2(Number(cf.montoUSD) * proporcion),
          montoARS: -r2(Number(cf.montoARS) * proporcion),
          tipoCambio: cf.tipoCambio,
          estado: 'NOTA_CREDITO',
          errorMessage: `${esTotal ? 'NC total' : 'Devolución'} s/ ${inv.invoiceNumber}: ${esTotal ? 'todo' : detalleDevolucion}`.slice(0, 2000),
          createdById: opts.userId,
          items: { create: itemsNegativos },
        },
      })
    }
    return nc.id
  }, { maxWait: 10000, timeout: 60000 })

  // Comisiones (best effort, fuera de la tx)
  if (inv.quote) {
    sincronizarComisionesDeQuote(inv.quote.id, { crearLiquidacion: filaNegativa }).catch((err) =>
      logger.error('[NC] Error re-sincronizando comisiones', { quoteId: inv.quote!.id, error: err?.message })
    )
  }

  // 4. Colppy
  let colppyId: string | null = null
  let colppyPendiente = false
  let colppyBorradorFce = false
  if (colppyPayload) {
    try {
      let session = await getCachedColppySession()
      let res
      try {
        res = await colppyCreateInvoice(session, colppyPayload)
      } catch (e) {
        if (e instanceof ColppySessionExpiredError) {
          invalidateColppySessionCache()
          session = await getCachedColppySession()
          res = await colppyCreateInvoice(session, colppyPayload)
        } else {
          throw e
        }
      }
      colppyId = res.idFactura
      colppyBorradorFce = !!res.borradorFce
      await prisma.invoice.update({
        where: { id: ncId },
        data: { colppyId, colppySyncStatus: res.borradorFce ? 'BORRADOR_FCE' : 'OK', colppySyncError: null },
      })
    } catch (e) {
      colppyPendiente = true
      const msg = (e as Error).message
      logger.error('[NC] Emitida en ARCA pero falló el alta en Colppy', { ncId, numero: numeroErp, error: msg })
      await prisma.invoice.update({ where: { id: ncId }, data: { colppySyncStatus: 'PENDIENTE', colppySyncError: msg.slice(0, 2000) } })
    }
  } else {
    logger.warn('[NC] La factura no tiene colppyPayload; la NC no se registra en Colppy automáticamente', { invoiceId })
  }

  archivarFacturaEnSharePointBg(ncId)

  return {
    ok: true,
    invoiceId: ncId,
    numero: em.numeroFormateado,
    cae: em.cae,
    caeVencimiento: em.caeVencimiento,
    total,
    esTotal,
    modo,
    advertencias,
    colppyPendiente,
    colppyBorradorFce,
    colppyId,
  }
}

/**
 * Nota de crédito de venta emitida por el ERP (ARCA WSFE) sobre una factura
 * que también emitió el ERP.
 *
 * Flujo:
 *   1. Emite la NC en ARCA asociada a la factura (misma letra, moneda y TC).
 *   2. Persiste la NC como Invoice (transactionType CREDIT_NOTE, relatedInvoiceId).
 *   3. NC total: anula la factura en el ERP (status CANCELLED), marca la
 *      CotizacionFactura como ANULADA, devuelve las cantidades a la cotización
 *      (cantidadFacturada) y reabre la cotización si corresponde; re-sincroniza
 *      comisiones.
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
import {
  calcularNcUnidades,
  claveLinea,
  lineasAcreditables,
  type CalculoNcUnidades,
  type LineaAcreditable,
  type SeleccionUnidades,
} from '@/lib/facturacion/nc-unidades'

export interface EmitirNotaCreditoOpts {
  userId: string
  motivo?: string
  /**
   * Importe NETO de la NC. Si se omite o es >= neto de la factura → NC TOTAL
   * (anula la factura y reabre la cotización). Si es menor → NC parcial: solo
   * ajusta saldo/total, no toca la cotización.
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
  modo: 'TOTAL' | 'IMPORTE' | 'UNIDADES'
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

/** Cantidades ya devueltas por línea (claveLinea) en NC por unidades anteriores. */
function acreditadoPorLinea(ncs: Array<{ transactionType: string; status: string; items: Array<{ sku: string | null; description: string | null; quantity: unknown }> }>) {
  const map = new Map<string, number>()
  for (const nc of ncs) {
    if (nc.transactionType !== 'CREDIT_NOTE' || nc.status === 'CANCELLED') continue
    for (const it of nc.items) {
      const k = claveLinea(it.sku, it.description)
      map.set(k, (map.get(k) ?? 0) + Number(it.quantity))
    }
  }
  return map
}

/**
 * Líneas de la factura para una NC por unidades, con lo ya devuelto y lo
 * disponible. null si la factura no tiene las líneas de Colppy guardadas.
 */
export async function obtenerLineasNcUnidades(invoiceId: string): Promise<{
  lineas: LineaAcreditable[]
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
      total: true,
      relatedInvoices: {
        select: { transactionType: true, status: true, total: true, items: { select: { sku: true, description: true, quantity: true } } },
      },
    },
  })
  const payload = (inv?.colppyPayload ?? null) as ColppyInvoicePayload | null
  if (!inv || !payload?.items?.length) return null
  const ncPrevias = inv.relatedInvoices
    .filter((r) => r.transactionType === 'CREDIT_NOTE' && r.status !== 'CANCELLED')
    .reduce((s, r) => s + Number(r.total), 0)
  return {
    lineas: lineasAcreditables(payload, acreditadoPorLinea(inv.relatedInvoices)),
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
      items: {
        select: { id: true, quoteItemId: true, quantity: true, description: true, unitPrice: true, subtotal: true, productId: true, sku: true, comment: true, product: { select: { sku: true } } },
      },
      relatedInvoices: {
        select: { id: true, transactionType: true, total: true, subtotal: true, taxAmount: true, status: true, items: { select: { sku: true, description: true, quantity: true } } },
      },
      cotizacionFactura: {
        select: { id: true, estado: true, montoUSD: true, montoARS: true, tipoCambio: true, items: { select: { cotizacionItemId: true, precioUnitario: true } } },
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

  // Modo e importes de la NC
  let modo: 'TOTAL' | 'IMPORTE' | 'UNIDADES'
  let calc: CalculoNcUnidades | null = null
  let neto: number
  let iva: number
  if (opts.unidades?.length) {
    if (!facturaPayload?.items?.length) {
      throw new NotaCreditoError('La factura no tiene el detalle de líneas guardado: usá el ajuste por importe')
    }
    const lineas = lineasAcreditables(facturaPayload, acreditadoPorLinea(inv.relatedInvoices))
    try {
      calc = calcularNcUnidades(facturaPayload, lineas, opts.unidades)
    } catch (e) {
      throw new NotaCreditoError((e as Error).message)
    }
    // Devuelve todo y no hubo NC antes: es una NC total (anula la factura)
    modo = calc.devuelveTodo && ncsVigentes.length === 0 ? 'TOTAL' : 'UNIDADES'
    neto = calc.neto
    iva = calc.iva
    // Si con esta NC se devuelve todo lo que quedaba, toma el remanente exacto
    // del encabezado (evita diferencias de centavos por redondeo por línea)
    const agotaTodo = lineas.every((l) => {
      const sel = opts.unidades!.find((u) => u.index === l.index)
      return l.cantidadDisponible === 0 || (!!sel && Number(sel.cantidad) >= l.cantidadDisponible)
    })
    if (modo === 'UNIDADES' && agotaTodo && ncsVigentes.length > 0) {
      neto = r2(netoFactura - ncsVigentes.reduce((acc, r) => acc + Number(r.subtotal), 0))
      iva = r2(ivaFactura - ncsVigentes.reduce((acc, r) => acc + Number(r.taxAmount), 0))
    }
  } else if (opts.netoParcial && opts.netoParcial > 0 && opts.netoParcial < netoFactura - 0.01) {
    modo = 'IMPORTE'
    neto = r2(opts.netoParcial)
    iva = r2(neto * 0.21)
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
                subtotal: neto,
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

  // Por unidades: cada línea devuelta se vincula al ítem de la factura (y de
  // la cotización) por código de artículo, o por descripción si no tiene. Las
  // líneas de adicionales o manuales no tienen ítem de cotización propio.
  const norm = (x: string | null | undefined) => (x ?? '').trim().toUpperCase()
  const devueltas = (calc?.detalle ?? []).map((d) => {
    const it =
      (d.linea.codigo && inv.items.find((i) => norm(i.sku || i.product?.sku) === norm(d.linea.codigo))) ||
      inv.items.find((i) => norm(i.description) === norm(d.linea.descripcion)) ||
      null
    return { ...d, invoiceItem: it }
  })
  const devueltasPorQuoteItem = new Map<string, number>()
  for (const d of devueltas) {
    const qi = d.invoiceItem?.quoteItemId
    if (qi) devueltasPorQuoteItem.set(qi, (devueltasPorQuoteItem.get(qi) ?? 0) + d.cantidad)
  }
  const detalleDevolucion = devueltas.map((d) => `${d.cantidad} × ${d.linea.codigo || d.linea.descripcion.slice(0, 40)}`).join(', ')

  // 2./3. Persistir NC + efectos sobre la factura/cotización
  const ncId = await prisma.$transaction(async (tx) => {
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
                quoteItemId: d.invoiceItem?.quoteItemId ?? null,
                productId: d.invoiceItem?.productId ?? null,
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
      if (inv.cotizacionFactura) {
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
      // Reabrir la cotización si estaba completamente facturada
      if (inv.quote && (inv.quote.status === 'CONVERTED' || inv.quote.status === 'FACTURADA_PARCIAL')) {
        const otrasVigentes = await tx.invoice.count({
          where: { quoteId: inv.quote.id, transactionType: 'SALE', status: { not: 'CANCELLED' }, id: { not: inv.id } },
        })
        const nuevoEstado = otrasVigentes > 0 ? 'FACTURADA_PARCIAL' : 'ACCEPTED'
        await tx.quote.update({
          where: { id: inv.quote.id },
          data: { status: nuevoEstado, statusUpdatedAt: now, statusUpdatedBy: opts.userId },
        })
        await tx.quoteStatusHistory.create({
          data: {
            quoteId: inv.quote.id,
            fromStatus: inv.quote.status,
            toStatus: nuevoEstado,
            changedBy: opts.userId,
            notes: `Factura ${inv.invoiceNumber} anulada por NC ${numeroErp}${motivo ? ` — ${motivo}` : ''}`,
          },
        })
      }
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
      if (inv.quote && inv.quote.status === 'CONVERTED') {
        await tx.quote.update({
          where: { id: inv.quote.id },
          data: { status: 'FACTURADA_PARCIAL', statusUpdatedAt: now, statusUpdatedBy: opts.userId },
        })
        await tx.quoteStatusHistory.create({
          data: {
            quoteId: inv.quote.id,
            fromStatus: 'CONVERTED',
            toStatus: 'FACTURADA_PARCIAL',
            changedBy: opts.userId,
            notes: `Devolución por NC ${numeroErp} (${detalleDevolucion})${motivo ? ` — ${motivo}` : ''}: unidades pendientes de nuevo`,
          },
        })
      }
    }

    // Comisiones: la devolución resta en el mes de la NC con una fila
    // negativa proporcional al importe devuelto (la factura original no se
    // toca; sirve aunque su mes ya esté cerrado).
    if (modo === 'UNIDADES' && inv.quote && inv.cotizacionFactura && netoFactura > 0) {
      const cf = inv.cotizacionFactura
      const proporcion = neto / netoFactura
      const precioPorItem = new Map(cf.items.map((i) => [i.cotizacionItemId, Number(i.precioUnitario)]))
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
          errorMessage: `Devolución s/ ${inv.invoiceNumber}: ${detalleDevolucion}`.slice(0, 2000),
          createdById: opts.userId,
          items: {
            create: Array.from(devueltasPorQuoteItem.entries())
              .filter(([qi]) => precioPorItem.has(qi))
              .map(([qi, qty]) => ({
                cotizacionItemId: qi,
                cantidad: -qty,
                precioUnitario: precioPorItem.get(qi)!,
                subtotal: -r2(precioPorItem.get(qi)! * qty),
              })),
          },
        },
      })
    }
    return nc.id
  }, { maxWait: 10000, timeout: 60000 })

  // Comisiones (best effort, fuera de la tx)
  if (inv.quote) {
    sincronizarComisionesDeQuote(inv.quote.id, { crearLiquidacion: modo === 'UNIDADES' }).catch((err) =>
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
    colppyPendiente,
    colppyBorradorFce,
    colppyId,
  }
}

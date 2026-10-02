/**
 * Vincula una factura importada de Colppy con el envío del ERP que la originó
 * (CotizacionFactura con el mismo colppyInvoiceId). Es el camino de las
 * facturas que el ERP mandó a Colppy como BORRADOR y Colppy emitió después
 * (numeración 0003-...): el sync importa el comprobante emitido y acá se le
 * devuelve la cotización, el número real al envío y, si la factura no tiene
 * ítems, los ítems del envío (los usa el cálculo de lo facturado por ítem).
 *
 * Antes la limpieza del sync borraba estas facturas a diario y se perdía el
 * vínculo (283 envíos sin factura al 1/10/2026, ver scripts/reparar-envios-colppy.ts).
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { logger } from '@/lib/logger'

type Db = PrismaClient | Prisma.TransactionClient

const r2 = (n: number) => Math.round(n * 100) / 100
const r4 = (n: number) => Math.round(n * 10000) / 10000

/** Estados de envío que no se tocan (no representan una venta vigente) */
export const ESTADOS_ENVIO_NO_VINCULABLES = ['ANULADA', 'ERROR_GUARDADO', 'NOTA_CREDITO']

/** Número real de Colppy (0003-00015423); los borradores tienen uno provisorio que se reemplaza. */
export const esNumeroColppy = (n: string | null | undefined) => !!n && /^\d{4,5}-\d{8}$/.test(n)

/**
 * Factor para pasar precios del envío (moneda de la cotización) a la moneda
 * de la factura. tipoCambio = el del envío (montoARS / montoUSD).
 */
export function factorMoneda(monedaCotizacion: string, monedaFactura: string, tipoCambio: number): number {
  if (monedaCotizacion === monedaFactura || !(tipoCambio > 0)) return 1
  if (monedaCotizacion === 'USD' && monedaFactura === 'ARS') return tipoCambio
  if (monedaCotizacion === 'ARS' && monedaFactura === 'USD') return 1 / tipoCambio
  return 1
}

/** InvoiceItems a partir de los ítems del envío (puro, testeable). */
export function itemsDesdeEnvio(
  envioItems: Array<{ cotizacionItemId: string; cantidad: unknown; precioUnitario: unknown; subtotal: unknown }>,
  quoteItems: Map<string, { productId: string | null; description: string | null; productName: string | null; sku: string | null }>,
  factor: number
) {
  return envioItems
    .filter((i) => Number(i.cantidad) > 0)
    .map((i) => {
      const qi = quoteItems.get(i.cotizacionItemId)
      return {
        quoteItemId: i.cotizacionItemId,
        productId: qi?.productId ?? null,
        sku: qi?.sku ?? null,
        description: qi?.description || qi?.productName || 'Item',
        quantity: Number(i.cantidad),
        unitPrice: r2(r4(Number(i.precioUnitario)) * factor),
        discount: 0,
        taxRate: 21,
        subtotal: r2(Number(i.subtotal) * factor),
      }
    })
}

export interface ResultadoVinculo {
  vinculado: boolean
  motivo?: string
  itemsCreados?: number
  quoteCambiado?: boolean
}

/**
 * Vincula `invoice` (importada de Colppy, NO emitida por el ERP) con su envío.
 * Idempotente: si ya está todo vinculado no hace nada. Llamar dentro de una
 * transacción (`db` = tx): bloquea la factura para que dos corridas
 * simultáneas (cron + botón "Sincronizar" + script) no dupliquen los ítems.
 * `systemUserId`: usuario por defecto del sync; el vendedor de la factura
 * solo se reemplaza si es ese o el de la cotización que se está corrigiendo
 * (no se pisa una asignación manual).
 */
export async function vincularEnvioColppy(
  db: Db,
  invoice: { id: string; colppyId: string; invoiceNumber: string; currency: string; quoteId: string | null },
  opts: { systemUserId?: string } = {}
): Promise<ResultadoVinculo> {
  await db.$queryRaw`SELECT id FROM invoices WHERE id = ${invoice.id} FOR UPDATE`
  const envio = await db.cotizacionFactura.findFirst({
    where: { colppyInvoiceId: invoice.colppyId, estado: { notIn: ESTADOS_ENVIO_NO_VINCULABLES } },
    orderBy: { fecha: 'desc' },
    select: {
      id: true,
      invoiceId: true,
      cotizacionId: true,
      numeroFactura: true,
      estado: true,
      tipoCambio: true,
      montoUSD: true,
      montoARS: true,
      cotizacion: { select: { currency: true, salesPersonId: true } },
      items: { select: { cotizacionItemId: true, cantidad: true, precioUnitario: true, subtotal: true } },
    },
  })
  if (!envio) return { vinculado: false, motivo: 'sin envío' }
  if (envio.invoiceId && envio.invoiceId !== invoice.id) {
    // El envío ya apunta a otra factura (no debería pasar: mismo colppyId)
    logger.warn('[Vincular envío Colppy] El envío ya está vinculado a otra factura', { envioId: envio.id, invoiceId: invoice.id, otra: envio.invoiceId })
    return { vinculado: false, motivo: 'envío vinculado a otra factura' }
  }

  // 1. Envío → factura, número real, EMITIDA (Colppy ya lo emitió)
  const numeroReal = esNumeroColppy(invoice.invoiceNumber) ? invoice.invoiceNumber : null
  const datosEnvio: Prisma.CotizacionFacturaUpdateInput = {}
  if (envio.invoiceId !== invoice.id) datosEnvio.invoice = { connect: { id: invoice.id } }
  if (numeroReal && envio.numeroFactura !== numeroReal) datosEnvio.numeroFactura = numeroReal
  // Solo con número real: un "BORRADOR-COLPPY-..." todavía no se emitió
  if (envio.estado === 'BORRADOR' && numeroReal) datosEnvio.estado = 'EMITIDA'
  if (Object.keys(datosEnvio).length) await db.cotizacionFactura.update({ where: { id: envio.id }, data: datosEnvio })

  // 2. Factura → cotización del envío (gana sobre el match por importe)
  const quoteCambiado = invoice.quoteId !== envio.cotizacionId
  if (quoteCambiado) {
    const actual = await db.invoice.findUnique({
      where: { id: invoice.id },
      select: { userId: true, quote: { select: { salesPersonId: true } } },
    })
    // Vendedor: solo si es el default del sync o el de la cotización equivocada
    const reemplazarVendedor =
      !!envio.cotizacion.salesPersonId &&
      !!actual &&
      (actual.userId === opts.systemUserId || (!!actual.quote && actual.userId === actual.quote.salesPersonId))
    await db.invoice.update({
      where: { id: invoice.id },
      data: { quoteId: envio.cotizacionId, ...(reemplazarVendedor ? { userId: envio.cotizacion.salesPersonId } : {}) },
    })
  }

  // 3. Ítems: solo si la factura no tiene (no pisar los del envío original)
  let itemsCreados = 0
  const tieneItems = await db.invoiceItem.count({ where: { invoiceId: invoice.id } })
  if (!tieneItems && envio.items.length) {
    const qis = await db.quoteItem.findMany({
      where: { id: { in: envio.items.map((i) => i.cotizacionItemId) } },
      select: { id: true, productId: true, description: true, manualSku: true, product: { select: { name: true, sku: true } } },
    })
    const mapa = new Map(
      qis.map((q) => [q.id, { productId: q.productId, description: q.description, productName: q.product?.name ?? null, sku: q.product?.sku ?? q.manualSku ?? null }])
    )
    const tc = Number(envio.montoUSD) > 0 ? Number(envio.montoARS) / Number(envio.montoUSD) : Number(envio.tipoCambio)
    const items = itemsDesdeEnvio(envio.items, mapa, factorMoneda(envio.cotizacion.currency, invoice.currency, tc))
    if (items.length) {
      await db.invoiceItem.createMany({ data: items.map((i) => ({ ...i, invoiceId: invoice.id })) })
      itemsCreados = items.length
    }
  }
  return { vinculado: true, itemsCreados, quoteCambiado }
}

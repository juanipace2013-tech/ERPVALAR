/**
 * Inspección puntual de VAL-2026-521 + estimación de alcance de cotizaciones
 * potencialmente afectadas por el bug de facturación parcial (Colppy emite
 * pero el guardado en DB falla silenciosamente).
 *
 * SOLO LEE. No modifica nada.
 *
 * Correr:
 *   npx tsx scripts/inspect-coarco-521.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const QUOTE_NUMBER = 'VAL-2026-521'

async function main() {
  // ─────────────────────────────────────────────────────────────────────
  // 1) ESTADO ACTUAL DE VAL-2026-521
  // ─────────────────────────────────────────────────────────────────────
  console.log(`\n═══ Inspección de ${QUOTE_NUMBER} ═══\n`)

  const quote = await prisma.quote.findFirst({
    where: { quoteNumber: QUOTE_NUMBER },
    include: {
      customer: { select: { name: true, cuit: true, paymentTerms: true } },
      salesPerson: { select: { name: true, email: true } },
      items: {
        where: { isAlternative: false },
        select: {
          id: true,
          itemNumber: true,
          description: true,
          quantity: true,
          cantidadFacturada: true,
          unitPrice: true,
          productId: true,
        },
        orderBy: { itemNumber: 'asc' },
      },
    },
  })

  if (!quote) {
    console.log(`❌ ${QUOTE_NUMBER} no encontrada.`)
    return
  }

  console.log('📋 COTIZACIÓN')
  console.log({
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    cliente: quote.customer.name,
    cuit: quote.customer.cuit,
    paymentTerms: quote.customer.paymentTerms,
    vendedor: quote.salesPerson.name,
    status: quote.status,
    currency: quote.currency,
    total: quote.total.toString(),
    exchangeRate: quote.exchangeRate.toString(),
    colppyInvoiceId: quote.colppyInvoiceId,
    colppyDeliveryNoteId: quote.colppyDeliveryNoteId,
    colppySyncedAt: quote.colppySyncedAt,
    statusUpdatedAt: quote.statusUpdatedAt,
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
  })

  // ─────────────────────────────────────────────────────────────────────
  // 2) ITEMS — para ver si cantidadFacturada se incrementó o no
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n📦 ITEMS')
  let totalQty = 0
  let totalFact = 0
  for (const it of quote.items) {
    const q = Number(it.quantity)
    const fact = Number(it.cantidadFacturada)
    totalQty += q
    totalFact += fact
    console.log({
      itemNumber: it.itemNumber,
      desc: (it.description || '').slice(0, 60),
      qty: q,
      facturada: fact,
      pendiente: q - fact,
      unitPriceUSD: Number(it.unitPrice).toFixed(2),
    })
  }
  console.log(`\n  TOTALES → qty:${totalQty}  facturada:${totalFact}  pendiente:${totalQty - totalFact}`)

  // ─────────────────────────────────────────────────────────────────────
  // 3) COTIZACION_FACTURAS asociadas (debería tener al menos 1 si la
  //    factura de Colppy se persistió correctamente)
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n💰 CotizacionFactura asociadas')
  const cfs = await prisma.cotizacionFactura.findMany({
    where: { cotizacionId: quote.id },
    include: {
      items: {
        select: {
          cotizacionItemId: true,
          cantidad: true,
          subtotal: true,
        },
      },
      invoice: { select: { id: true, invoiceNumber: true, status: true, colppyId: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  console.log(`Total filas: ${cfs.length}`)
  for (const cf of cfs) {
    console.log({
      id: cf.id,
      numeroFactura: cf.numeroFactura,
      colppyInvoiceId: cf.colppyInvoiceId,
      estado: cf.estado,
      errorMessage: cf.errorMessage,
      montoUSD: cf.montoUSD.toString(),
      montoARS: cf.montoARS.toString(),
      tipoCambio: cf.tipoCambio.toString(),
      fecha: cf.fecha,
      createdAt: cf.createdAt,
      items: cf.items.length,
      invoiceLink: cf.invoice
        ? { id: cf.invoice.id, num: cf.invoice.invoiceNumber, colppyId: cf.invoice.colppyId, status: cf.invoice.status }
        : null,
    })
  }

  // ─────────────────────────────────────────────────────────────────────
  // 4) INVOICES (modelo legacy) asociadas — también debería tener una si
  //    el guardado completó
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n🧾 Invoice (legacy) asociadas')
  const invoices = await prisma.invoice.findMany({
    where: { quoteId: quote.id },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      colppyId: true,
      total: true,
      currency: true,
      issueDate: true,
      createdAt: true,
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  console.log(`Total filas: ${invoices.length}`)
  for (const inv of invoices) {
    console.log({
      ...inv,
      total: inv.total.toString(),
    })
  }

  // ─────────────────────────────────────────────────────────────────────
  // 5) QUOTE_STATUS_HISTORY — para ver si quedó registro de la transición
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n📜 QuoteStatusHistory (últimas 10)')
  const history = await prisma.quoteStatusHistory.findMany({
    where: { quoteId: quote.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      fromStatus: true,
      toStatus: true,
      notes: true,
      createdAt: true,
    },
  })
  for (const h of history) {
    console.log({
      from: h.fromStatus,
      to: h.toStatus,
      at: h.createdAt,
      notes: (h.notes || '').slice(0, 120),
    })
  }

  // ─────────────────────────────────────────────────────────────────────
  // 6) AUDIT LOG reciente del usuario — buscar si quedó un INVOICE/CREATE
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n🔍 AuditLog hoy con quote ' + QUOTE_NUMBER + ' o customer')
  const today0 = new Date()
  today0.setHours(0, 0, 0, 0)
  const audits = await prisma.auditLog.findMany({
    where: {
      createdAt: { gte: today0 },
      OR: [
        { entityRef: { contains: QUOTE_NUMBER } },
        { description: { contains: QUOTE_NUMBER } },
        { description: { contains: 'COARCO' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      action: true,
      entity: true,
      entityRef: true,
      description: true,
      userName: true,
      createdAt: true,
    },
  })
  console.log(`Total: ${audits.length}`)
  for (const a of audits) {
    console.log({
      at: a.createdAt,
      user: a.userName,
      action: a.action,
      entity: a.entity,
      entityRef: a.entityRef,
      desc: (a.description || '').slice(0, 140),
    })
  }

  // ─────────────────────────────────────────────────────────────────────
  // 7) ESTIMACIÓN DE ALCANCE
  //    Heurística: cotizaciones que parecen "haber pasado por Colppy"
  //    (colppySyncedAt seteado o algún ítem con cantidadFacturada > 0)
  //    pero que NO tienen ninguna fila en cotizacion_facturas.
  //    Se excluyen DRAFT/REJECTED/EXPIRED (no aplican). Para reducir
  //    falsos positivos pre-modelo nuevo, filtramos solo por las
  //    posteriores al despliegue del modelo CotizacionFactura.
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n\n═══ ESTIMACIÓN DE ALCANCE ═══\n')

  // Cota inferior para no contar cotizaciones viejas anteriores a CotizacionFactura.
  // Ajustá esta fecha si el deploy del modelo fue otro día.
  const SINCE = new Date('2026-05-01T00:00:00Z')

  const candidates = await prisma.quote.findMany({
    where: {
      updatedAt: { gte: SINCE },
      status: { in: ['ACCEPTED', 'FACTURADA_PARCIAL', 'CONVERTED'] },
      OR: [
        { colppySyncedAt: { not: null } },
        { items: { some: { cantidadFacturada: { gt: 0 } } } },
      ],
      facturas: { none: {} }, // sin filas en cotizacion_facturas
    },
    select: {
      id: true,
      quoteNumber: true,
      status: true,
      currency: true,
      total: true,
      colppyInvoiceId: true,
      colppySyncedAt: true,
      updatedAt: true,
      customer: { select: { name: true } },
      items: {
        where: { isAlternative: false },
        select: {
          quantity: true,
          cantidadFacturada: true,
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })

  console.log(`Candidatas (sin fila en cotizacion_facturas, con señales de envío): ${candidates.length}\n`)
  for (const c of candidates) {
    const qtyTotal = c.items.reduce((s, i) => s + Number(i.quantity), 0)
    const factTotal = c.items.reduce((s, i) => s + Number(i.cantidadFacturada), 0)
    console.log({
      quoteNumber: c.quoteNumber,
      cliente: c.customer.name,
      status: c.status,
      currency: c.currency,
      total: c.total.toString(),
      colppyInvoiceId: c.colppyInvoiceId,
      colppySyncedAt: c.colppySyncedAt,
      updatedAt: c.updatedAt,
      qty: qtyTotal,
      facturada: factTotal,
      pendiente: qtyTotal - factTotal,
    })
  }

  // ─────────────────────────────────────────────────────────────────────
  // 8) CHEQUEO COMPLEMENTARIO: cotizaciones FACTURADA_PARCIAL hoy/ayer,
  //    para ver si hay otras de Carolina en ventana cercana al bug.
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n\n═══ FACTURADA_PARCIAL en las últimas 48hs (todas) ═══\n')
  const last48 = new Date()
  last48.setHours(last48.getHours() - 48)
  const parciales = await prisma.quote.findMany({
    where: {
      status: 'FACTURADA_PARCIAL',
      statusUpdatedAt: { gte: last48 },
    },
    orderBy: { statusUpdatedAt: 'desc' },
    take: 50,
    select: {
      quoteNumber: true,
      customer: { select: { name: true } },
      salesPerson: { select: { name: true } },
      statusUpdatedAt: true,
      colppySyncedAt: true,
      _count: { select: { facturas: true, invoices: true } },
    },
  })
  console.log(`Total: ${parciales.length}`)
  for (const p of parciales) {
    console.log({
      q: p.quoteNumber,
      cliente: p.customer.name,
      vendedor: p.salesPerson.name,
      statusUpdatedAt: p.statusUpdatedAt,
      colppySyncedAt: p.colppySyncedAt,
      cotizacionFacturas: p._count.facturas,
      invoicesLegacy: p._count.invoices,
    })
  }

  console.log('\n✅ Inspección completada.\n')
}

main()
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

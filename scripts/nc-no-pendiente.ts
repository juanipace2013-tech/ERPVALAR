/**
 * Una NC por unidades que se emitió dejando las unidades PENDIENTES en la
 * cotización, pasa a "el cliente no las quiere": se repone en lo facturado
 * de la cotización exactamente lo que la NC había restado (las unidades
 * completas, ver nota-credito-arca.ts), la NC deja de restar en la
 * cotización y el estado se recalcula. La comisión no cambia (la fila
 * negativa de la NC queda, marcada como "sin pendiente" para el pipeline).
 *
 *   npx tsx scripts/nc-no-pendiente.ts NCA-0007-00000001          (simulación)
 *   npx tsx scripts/nc-no-pendiente.ts NCA-0007-00000001 --apply
 */
import { prisma } from '@/lib/prisma'
import { signoCantidad } from '@/lib/facturacion/cantidades'
import { MARCA_NC_SIN_PENDIENTE } from '@/lib/comisiones/liquidacion'

const numero = process.argv[2]
const apply = process.argv.includes('--apply')

async function main() {
  if (!numero) throw new Error('Uso: npx tsx scripts/nc-no-pendiente.ts <numero NC> [--apply]')
  const nc = await prisma.invoice.findFirst({
    where: { invoiceNumber: numero, transactionType: 'CREDIT_NOTE' },
    select: {
      id: true,
      userId: true,
      quote: { select: { id: true, quoteNumber: true, status: true } },
      items: { where: { quoteItemId: { not: null } }, select: { id: true, quoteItemId: true, quantity: true, sku: true } },
      // Fila de comisión de la NC: sus ítems tienen lo que se restó (−unidades completas)
      cotizacionFactura: { select: { id: true, estado: true, errorMessage: true, items: { select: { cotizacionItemId: true, cantidad: true } } } },
    },
  })
  if (!nc) throw new Error(`No existe la NC ${numero}`)
  if (!nc.quote) throw new Error('La NC no tiene cotización')
  if (!nc.items.length) {
    console.log('La NC no tiene unidades vinculadas a la cotización: nada que hacer')
    return
  }

  // Lo que la NC restó de cantidadFacturada por ítem de cotización
  const restado = new Map<string, number>()
  if (nc.cotizacionFactura?.estado === 'NOTA_CREDITO' && nc.cotizacionFactura.items.length) {
    for (const i of nc.cotizacionFactura.items) restado.set(i.cotizacionItemId, (restado.get(i.cotizacionItemId) ?? 0) + Math.abs(Number(i.cantidad)))
  } else {
    // Sin fila de comisión (factura sin comisión): lo de las líneas de la NC
    for (const it of nc.items) restado.set(it.quoteItemId!, (restado.get(it.quoteItemId!) ?? 0) + Number(it.quantity))
  }
  const qis = await prisma.quoteItem.findMany({
    where: { id: { in: Array.from(restado.keys()) } },
    select: { id: true, quantity: true, cantidadFacturada: true },
  })
  console.log(`NC ${numero} → cotización ${nc.quote.quoteNumber} (${nc.quote.status})`)
  for (const qi of qis) {
    const r = restado.get(qi.id) ?? 0
    const nuevo = Number(qi.cantidadFacturada) + r
    console.log(`  ítem ${qi.id}: facturado ${Number(qi.cantidadFacturada)} → ${Math.min(nuevo, qi.quantity)} de ${qi.quantity}${nuevo > qi.quantity ? ' (OJO: pasaba la cantidad cotizada; ¿ya se re-facturó?)' : ''}`)
  }
  if (!apply) {
    console.log('SIMULACIÓN: no se cambió nada. Correr con --apply.')
    return
  }

  const quote = nc.quote
  await prisma.$transaction(async (tx) => {
    for (const [qiId, qty] of restado) {
      await tx.$executeRaw`
        UPDATE quote_items
        SET "cantidadFacturada" = LEAST("cantidadFacturada" + ${qty}::numeric, quantity), "updatedAt" = NOW()
        WHERE id = ${qiId}
      `
    }
    await tx.invoiceItem.updateMany({ where: { invoiceId: nc.id }, data: { quoteItemId: null } })
    if (nc.cotizacionFactura && !nc.cotizacionFactura.errorMessage?.startsWith(MARCA_NC_SIN_PENDIENTE)) {
      await tx.cotizacionFactura.update({
        where: { id: nc.cotizacionFactura.id },
        data: { errorMessage: `${MARCA_NC_SIN_PENDIENTE} ${nc.cotizacionFactura.errorMessage ?? ''}`.slice(0, 2000) },
      })
    }
    // Estado por lo facturado neto: nada → Aceptada; algo → parcial; todo → Convertida
    const items = await tx.quoteItem.findMany({
      where: { quoteId: quote.id, isAlternative: false },
      select: {
        quantity: true,
        cantidadFacturada: true,
        invoiceItems: { select: { quantity: true, invoice: { select: { status: true, transactionType: true } } } },
      },
    })
    const facturado = items.map((it) => {
      const porFacturas = it.invoiceItems
        .filter((ii) => ii.invoice.status !== 'CANCELLED')
        .reduce((s, ii) => s + signoCantidad(ii.invoice) * Number(ii.quantity), 0)
      return { q: it.quantity, f: Math.max(porFacturas, Number(it.cantidadFacturada)) }
    })
    const nuevo = facturado.every((x) => x.f >= x.q) ? 'CONVERTED' : facturado.some((x) => x.f > 0) ? 'FACTURADA_PARCIAL' : 'ACCEPTED'
    const aplica = ['ACCEPTED', 'FACTURADA_PARCIAL', 'CONVERTED'].includes(quote.status)
    const final = aplica ? nuevo : quote.status
    if (final !== quote.status) {
      await tx.quote.update({
        where: { id: quote.id },
        data: { status: final, statusUpdatedAt: new Date(), statusUpdatedBy: nc.userId },
      })
    }
    await tx.quoteStatusHistory.create({
      data: {
        quoteId: quote.id,
        fromStatus: quote.status,
        toStatus: final,
        changedBy: nc.userId,
        notes: `Devolución por NC ${numero}: no vuelve a pendiente (el cliente no las quiere)`,
      },
    })
    console.log(`Cotización ${quote.quoteNumber}: ${quote.status} → ${final}`)
  })
}

main()
  .catch((e) => {
    console.error('ERROR:', (e as Error).message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

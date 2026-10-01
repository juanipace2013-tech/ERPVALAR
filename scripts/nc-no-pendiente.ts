/**
 * Una NC por unidades que se emitió dejando las unidades PENDIENTES en la
 * cotización, pasa a "el cliente no las quiere": las unidades vuelven a
 * contar como facturadas (no pendientes) y la cotización vuelve a su estado.
 * La comisión no cambia (la fila negativa de la NC queda).
 *
 *   npx tsx scripts/nc-no-pendiente.ts NCA-0007-00000001          (simulación)
 *   npx tsx scripts/nc-no-pendiente.ts NCA-0007-00000001 --apply
 */
import { prisma } from '@/lib/prisma'
import { signoCantidad } from '@/lib/facturacion/cantidades'

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
    },
  })
  if (!nc) throw new Error(`No existe la NC ${numero}`)
  if (!nc.quote) throw new Error('La NC no tiene cotización')
  if (!nc.items.length) {
    console.log('La NC no tiene unidades vinculadas a la cotización: nada que hacer')
    return
  }
  console.log(`NC ${numero} → cotización ${nc.quote.quoteNumber} (${nc.quote.status})`)
  for (const it of nc.items) console.log(`  ${it.sku} × ${Number(it.quantity)} (quoteItem ${it.quoteItemId}) deja de estar pendiente`)
  if (!apply) {
    console.log('SIMULACIÓN: no se cambió nada. Correr con --apply.')
    return
  }
  const quote = nc.quote
  await prisma.$transaction(async (tx) => {
    for (const it of nc.items) {
      // Vuelve a contar como facturada (sin pasar la cantidad cotizada)
      await tx.$executeRaw`
        UPDATE quote_items
        SET "cantidadFacturada" = LEAST("cantidadFacturada" + ${Number(it.quantity)}::numeric, quantity), "updatedAt" = NOW()
        WHERE id = ${it.quoteItemId}
      `
      await tx.invoiceItem.update({ where: { id: it.id }, data: { quoteItemId: null } })
    }
    // Estado: si no queda nada pendiente, Convertida
    const items = await tx.quoteItem.findMany({
      where: { quoteId: quote.id, isAlternative: false },
      select: {
        quantity: true,
        cantidadFacturada: true,
        invoiceItems: { select: { quantity: true, invoice: { select: { status: true, transactionType: true } } } },
      },
    })
    const pendiente = items.some((it) => {
      const porFacturas = it.invoiceItems
        .filter((ii) => ii.invoice.status !== 'CANCELLED')
        .reduce((s, ii) => s + signoCantidad(ii.invoice) * Number(ii.quantity), 0)
      return Math.max(porFacturas, Number(it.cantidadFacturada)) < it.quantity
    })
    const nuevo = pendiente ? 'FACTURADA_PARCIAL' : 'CONVERTED'
    if (nuevo !== quote.status && (quote.status === 'FACTURADA_PARCIAL' || quote.status === 'CONVERTED')) {
      await tx.quote.update({ where: { id: quote.id }, data: { status: nuevo, statusUpdatedAt: new Date() } })
    }
    await tx.quoteStatusHistory.create({
      data: {
        quoteId: quote.id,
        fromStatus: quote.status,
        toStatus: nuevo,
        changedBy: nc.userId,
        notes: `Devolución por NC ${numero}: no vuelve a pendiente (el cliente no las quiere)`,
      },
    })
    console.log(`Cotización ${quote.quoteNumber}: ${quote.status} → ${nuevo}`)
  })
}

main()
  .catch((e) => {
    console.error('ERROR:', (e as Error).message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

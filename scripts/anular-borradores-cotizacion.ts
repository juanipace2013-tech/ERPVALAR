/**
 * Repara una cotización que quedó con "facturado fantasma": se envió la FC
 * borrador a Colppy, se revirtió el estado desde la UI (que antes solo limpiaba
 * los campos Colppy de la cotización) y quedaron vivos el Invoice DRAFT
 * `BORRADOR-COLPPY-*`, la CotizacionFactura en BORRADOR y cantidadFacturada.
 * Resultado: la cotización aparece en Pendientes con los ítems como
 * "Facturado" y no deja volver a facturar (caso VAL-2026-1327).
 *
 * Uso:
 *   npx tsx scripts/anular-borradores-cotizacion.ts VAL-2026-1327          (dry run)
 *   npx tsx scripts/anular-borradores-cotizacion.ts VAL-2026-1327 --apply
 *
 * NO toca nada en Colppy: si el borrador sigue existiendo allá, eliminarlo a mano.
 */
import 'dotenv/config';
import { prisma } from '@/lib/prisma';
import { anularBorradoresColppy } from '@/lib/quote-workflow';

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const isDryRun = !process.argv.includes('--apply');
const quoteNumber = args[0];

async function main() {
  if (!quoteNumber) {
    console.error('Uso: npx tsx scripts/anular-borradores-cotizacion.ts <quoteNumber> [--apply]');
    process.exit(1);
  }
  console.log(`Modo: ${isDryRun ? 'DRY RUN' : 'APPLY'}\n`);

  const quote = await prisma.quote.findFirst({
    where: { quoteNumber },
    include: {
      customer: { select: { name: true } },
      invoices: { select: { id: true, invoiceNumber: true, status: true, total: true } },
      facturas: { select: { id: true, numeroFactura: true, estado: true } },
      items: {
        include: {
          invoiceItems: { include: { invoice: { select: { status: true, invoiceNumber: true } } } },
        },
      },
    },
  });

  if (!quote) {
    console.error(`No se encontró la cotización ${quoteNumber}`);
    process.exit(1);
  }

  console.log(`Cotización ${quote.quoteNumber} — ${quote.customer.name}`);
  console.log(`  status: ${quote.status}`);
  console.log(`  colppyInvoiceId: ${quote.colppyInvoiceId ?? 'null'}`);
  console.log(`  colppyDeliveryNoteId: ${quote.colppyDeliveryNoteId ?? 'null'}`);
  console.log(`  colppySyncedAt: ${quote.colppySyncedAt?.toISOString() ?? 'null'}\n`);

  if (quote.status !== 'ACCEPTED') {
    console.error(
      `La cotización está en ${quote.status}, no en ACCEPTED. Este script es solo para el caso ` +
      `"revertida pero con borradores fantasma". Si sigue en CONVERTED/FACTURADA_PARCIAL, ` +
      `usar "Revertir a Aceptada" desde la UI (ya anula los borradores).`
    );
    process.exit(1);
  }

  const borradores = quote.invoices.filter(
    (i) => i.status === 'DRAFT' && i.invoiceNumber.startsWith('BORRADOR-COLPPY-')
  );
  const cfBorrador = quote.facturas.filter((cf) => cf.estado === 'BORRADOR');

  console.log(`Invoices DRAFT BORRADOR-COLPPY-* a anular: ${borradores.length}`);
  for (const b of borradores) console.log(`  ${b.invoiceNumber} (total ${b.total})`);
  console.log(`CotizacionFactura en BORRADOR a marcar ANULADA: ${cfBorrador.length}`);
  for (const cf of cfBorrador) console.log(`  ${cf.id} (${cf.numeroFactura ?? 'sin número'})`);

  const borradorIds = new Set(borradores.map((b) => b.id));
  console.log('\ncantidadFacturada por item (actual → recalculada sin los borradores):');
  for (const item of quote.items) {
    const vigente = item.invoiceItems
      .filter((ii) => ii.invoice.status !== 'CANCELLED' && !borradorIds.has(ii.invoiceId))
      .reduce((sum, ii) => sum + Number(ii.quantity), 0);
    console.log(`  item #${item.itemNumber}: ${Number(item.cantidadFacturada)} → ${vigente} (cotizado: ${item.quantity})`);
  }

  if (quote.colppyInvoiceId || quote.colppyDeliveryNoteId) {
    console.log('\nATENCIÓN: la cotización todavía tiene IDs de Colppy seteados; revisar a mano si corresponde limpiarlos.');
  }

  if (borradores.length === 0 && cfBorrador.length === 0) {
    const conCantidad = quote.items.some((i) => Number(i.cantidadFacturada) > 0);
    if (!conCantidad) {
      console.log('\nNada que anular: la cotización ya está limpia.');
      return;
    }
  }

  if (isDryRun) {
    console.log('\nDRY RUN — no se aplicaron cambios. Correr con --apply para ejecutar.');
    return;
  }

  const count = await prisma.$transaction(
    (tx) => anularBorradoresColppy(tx, quote.id),
    { maxWait: 10000, timeout: 30000 }
  );
  console.log(`\n✓ Listo: ${count} borrador(es) anulados, CotizacionFactura marcadas ANULADA y cantidadFacturada recalculada.`);
  console.log('La cotización debería reaparecer facturable en el tablero de Pendientes.');
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

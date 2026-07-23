/**
 * Anula la(s) CotizacionFactura de una cotización porque en Colppy se le hizo
 * una Nota de Crédito total (caso típico: cambio de CUIT, la venta se
 * re-facturó con otra cotización). La línea deja de contar en la liquidación
 * de comisiones del mes al re-sincronizar.
 *
 * Busca la NC en la tabla Invoice (sync de Colppy) para dejarla referenciada;
 * si no está sincronizada, permite anular igual con --force.
 *
 * Uso:
 *   npx tsx scripts/anular-factura-por-nc.ts VAL-2026-1533           (dry run)
 *   npx tsx scripts/anular-factura-por-nc.ts VAL-2026-1533 --apply
 *   npx tsx scripts/anular-factura-por-nc.ts VAL-2026-1533 --apply --force
 *
 * NO toca nada en Colppy.
 */
import 'dotenv/config';
import { prisma } from '@/lib/prisma';
import { sincronizarComisionesDeQuote } from '@/lib/comisiones/liquidacion';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const isDryRun = !process.argv.includes('--apply');
const force = process.argv.includes('--force');
const quoteNumber = args[0];

async function main() {
  if (!quoteNumber) {
    console.error('Uso: npx tsx scripts/anular-factura-por-nc.ts <quoteNumber> [--apply] [--force]');
    process.exit(1);
  }
  console.log(`Modo: ${isDryRun ? 'DRY RUN' : 'APPLY'}${force ? ' (force)' : ''}\n`);

  const quote = await prisma.quote.findFirst({
    where: { quoteNumber },
    include: {
      customer: { select: { id: true, name: true, cuit: true } },
      salesPerson: { select: { name: true } },
      facturas: true,
    },
  });
  if (!quote) {
    console.error(`No existe la cotización ${quoteNumber}`);
    process.exit(1);
  }

  console.log(`Cotización: ${quote.quoteNumber} — ${quote.customer.name} (CUIT ${quote.customer.cuit})`);
  console.log(`Vendedor: ${quote.salesPerson?.name ?? quote.salesPersonId}\n`);

  const vigentes = quote.facturas.filter((f) => !['ANULADA', 'ERROR_GUARDADO'].includes(f.estado));
  console.log(`Facturas parciales: ${quote.facturas.length} (${vigentes.length} vigentes)`);
  for (const f of quote.facturas) {
    console.log(
      `  - ${f.numeroFactura ?? 'S/N'} | ${f.fecha.toISOString().slice(0, 10)} | USD ${f.montoUSD} | ${f.estado}`
    );
  }
  if (vigentes.length === 0) {
    console.log('\nNo hay facturas vigentes para anular. Nada que hacer.');
    return;
  }

  // Buscar NC sincronizadas de Colppy para este cliente
  const ncs = await prisma.invoice.findMany({
    where: {
      transactionType: 'CREDIT_NOTE',
      customerId: quote.customer.id,
      status: { not: 'CANCELLED' },
    },
    select: { id: true, invoiceNumber: true, currency: true, subtotal: true, total: true, issueDate: true },
    orderBy: { issueDate: 'desc' },
  });
  console.log(`\nNC de Colppy sincronizadas para el cliente: ${ncs.length}`);
  for (const n of ncs) {
    console.log(`  - ${n.invoiceNumber} | ${n.issueDate.toISOString().slice(0, 10)} | ${n.currency} neto ${n.subtotal} (total ${n.total})`);
  }

  for (const f of vigentes) {
    const monto = Number(f.montoUSD);
    const tolerancia = Math.max(1, monto * 0.005);
    // montoUSD es neto sin IVA: se compara contra el subtotal (neto) de la NC.
    const nc = ncs.find((n) => {
      const netoNC = Number(n.subtotal) > 0 ? Number(n.subtotal) : Number(n.total);
      return n.currency === 'USD' && Math.abs(netoNC - monto) <= tolerancia;
    });

    let errorMessage: string;
    if (nc) {
      errorMessage = `ANULADA_POR_NC:${nc.id}: NC ${nc.invoiceNumber} de Colppy anula esta factura`;
    } else if (force) {
      errorMessage = 'ANULADA por NC total hecha en Colppy (sin sync local, marcada a mano)';
    } else {
      console.log(
        `\nFactura ${f.numeroFactura}: no encontré NC USD por ~${monto} sincronizada. ` +
          'Corré el sync de facturación de Colppy o usá --force para anular igual.'
      );
      continue;
    }

    console.log(`\nFactura ${f.numeroFactura} (USD ${monto}) → ANULADA`);
    console.log(`  Motivo: ${errorMessage}`);
    if (!isDryRun) {
      await prisma.cotizacionFactura.update({
        where: { id: f.id },
        data: { estado: 'ANULADA', errorMessage },
      });
    }
  }

  if (!isDryRun) {
    console.log('\nRe-sincronizando liquidaciones de comisiones de los meses afectados...');
    await sincronizarComisionesDeQuote(quote.id, { crearLiquidacion: false });
    console.log('Listo.');
  } else {
    console.log('\nDRY RUN: no se modificó nada. Repetir con --apply para aplicar.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * Backfill: crear CotizacionFactura + CotizacionFacturaItem desde las Invoice
 * legacy generadas por envíos a Colppy.
 *
 * Detección:
 *   - Invoice.quoteId NOT NULL (factura nace de cotización)
 *   - Quote.colppyInvoiceId NOT NULL (la cotización fue enviada a Colppy alguna vez)
 *   - invoiceNumber LIKE 'BORRADOR-COLPPY-%' (marcador determinístico que setea
 *     nuestro código en send-to-colppy / generate-invoice)
 *
 * Idempotencia: si la Invoice ya tiene una CotizacionFactura asociada
 * (cotizacionFactura no nulo), se saltea.
 *
 * Modo:
 *   --apply     ejecuta los inserts (default: dry-run, no escribe nada)
 *
 * Uso:
 *   npx tsx scripts/backfill-cotizacion-facturas.ts            # dry-run
 *   npx tsx scripts/backfill-cotizacion-facturas.ts --apply    # ejecuta
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const isDryRun = !process.argv.includes("--apply");
const BATCH_SIZE = 25;

interface PlanRow {
  invoiceId: string;
  invoiceNumber: string;
  quoteId: string;
  quoteNumber: string;
  customerName: string;
  numItems: number;
  subtotal: number;
  currency: string;
  exchangeRate: number;
  montoUSD: number;
  montoARS: number;
  fecha: Date;
  userId: string;
  colppyInvoiceId: string | null;
  items: Array<{
    cotizacionItemId: string;
    cantidad: number;
    precioUnitario: number;
    subtotal: number;
  }>;
}

async function main() {
  console.log(`==============================================`);
  console.log(`Backfill CotizacionFactura desde Invoice`);
  console.log(`Modo: ${isDryRun ? "DRY-RUN (no escribe)" : "APPLY (escribe en DB)"}`);
  console.log(`==============================================\n`);

  // 1. Recolectar Invoices candidatas
  const invoices = await prisma.invoice.findMany({
    where: {
      quoteId: { not: null },
      invoiceNumber: { startsWith: "BORRADOR-COLPPY-" },
      cotizacionFactura: { is: null },
      quote: {
        is: { colppyInvoiceId: { not: null } },
      },
    },
    include: {
      items: {
        select: {
          quoteItemId: true,
          quantity: true,
          unitPrice: true,
          subtotal: true,
        },
      },
      quote: {
        select: {
          id: true,
          quoteNumber: true,
          colppyInvoiceId: true,
          customer: { select: { name: true } },
        },
      },
    },
    orderBy: { issueDate: "asc" },
  });

  console.log(`Invoices candidatas detectadas: ${invoices.length}\n`);

  if (invoices.length === 0) {
    console.log("Nada que migrar. Saliendo.");
    return;
  }

  // 2. Construir plan
  const plan: PlanRow[] = [];
  let skippedNoItems = 0;
  let skippedBadItem = 0;

  for (const inv of invoices) {
    if (!inv.quote || !inv.quoteId) continue;

    // Solo InvoiceItems con quoteItemId (los Colppy borradores siempre tienen
    // quoteItemId — los items manuales sin link no van).
    const validItems = inv.items.filter((it) => it.quoteItemId != null);
    if (validItems.length === 0) {
      skippedNoItems++;
      continue;
    }

    const subtotal = Number(inv.subtotal);
    const exchangeRate = inv.exchangeRate ? Number(inv.exchangeRate) : 1;
    const isUSD = inv.currency === "USD";
    const montoUSD = isUSD ? subtotal : subtotal / (exchangeRate || 1);
    const montoARS = isUSD ? subtotal * exchangeRate : subtotal;

    plan.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      quoteId: inv.quoteId,
      quoteNumber: inv.quote.quoteNumber,
      customerName: inv.quote.customer.name,
      numItems: validItems.length,
      subtotal,
      currency: inv.currency,
      exchangeRate,
      montoUSD,
      montoARS,
      fecha: inv.issueDate,
      userId: inv.userId,
      colppyInvoiceId: inv.quote.colppyInvoiceId,
      items: validItems.map((it) => ({
        cotizacionItemId: it.quoteItemId!,
        cantidad: Number(it.quantity),
        precioUnitario: Number(it.unitPrice),
        subtotal: Number(it.subtotal),
      })),
    });
  }

  if (skippedNoItems > 0) {
    console.log(`Salteadas por no tener items con quoteItemId: ${skippedNoItems}`);
  }
  if (skippedBadItem > 0) {
    console.log(`Salteadas por items inválidos: ${skippedBadItem}`);
  }

  // 3. Resumen
  console.log(`CotizacionFactura a crear: ${plan.length}`);
  const distinctQuotes = new Set(plan.map((p) => p.quoteId));
  console.log(`Cotizaciones afectadas: ${distinctQuotes.size}\n`);

  // 4. Detalle: 20 primeras + ALL PUMPS + VAL-2026-475
  const interesantes = plan.filter(
    (p) =>
      p.quoteNumber === "VAL-2026-475" ||
      p.customerName.toUpperCase().includes("ALL PUMPS")
  );

  const detail = [
    ...plan.slice(0, 20),
    ...interesantes.filter(
      (p) => !plan.slice(0, 20).find((x) => x.invoiceId === p.invoiceId)
    ),
  ];

  console.log("Detalle (primeros 20 + casos de interés):");
  for (const p of detail) {
    const mark =
      p.quoteNumber === "VAL-2026-475" ||
      p.customerName.toUpperCase().includes("ALL PUMPS")
        ? " ⭐"
        : "";
    console.log(
      `  ${p.quoteNumber}  ${p.customerName.padEnd(35).slice(0, 35)}  ` +
        `${p.numItems} items  USD ${p.montoUSD.toFixed(2).padStart(12)}  ` +
        `factura=${p.invoiceNumber}${mark}`
    );
  }
  if (plan.length > 20 && interesantes.length === 0) {
    console.log(`  ...y ${plan.length - 20} más`);
  }
  console.log();

  if (interesantes.length === 0) {
    console.log("(No se detectó VAL-2026-475 ni ALL PUMPS entre las candidatas)\n");
  }

  if (isDryRun) {
    console.log("DRY-RUN — no se aplicaron cambios.");
    console.log("Para ejecutar:  npx tsx scripts/backfill-cotizacion-facturas.ts --apply");
    return;
  }

  // 5. Aplicar en batches
  console.log(`Aplicando en batches de ${BATCH_SIZE}...\n`);
  const totalBatches = Math.ceil(plan.length / BATCH_SIZE);
  let creados = 0;
  let fallidos = 0;

  for (let i = 0; i < plan.length; i += BATCH_SIZE) {
    const batch = plan.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    try {
      await prisma.$transaction(
        batch.map((p) =>
          prisma.cotizacionFactura.create({
            data: {
              cotizacionId: p.quoteId,
              invoiceId: p.invoiceId,
              colppyInvoiceId: p.colppyInvoiceId,
              numeroFactura: p.invoiceNumber.replace(/^BORRADOR-COLPPY-/, "") || null,
              fecha: p.fecha,
              montoUSD: p.montoUSD,
              montoARS: p.montoARS,
              tipoCambio: p.exchangeRate,
              estado: "BORRADOR",
              createdById: p.userId,
              items: {
                create: p.items.map((it) => ({
                  cotizacionItemId: it.cotizacionItemId,
                  cantidad: it.cantidad,
                  precioUnitario: it.precioUnitario,
                  subtotal: it.subtotal,
                })),
              },
            },
          })
        )
      );
      creados += batch.length;
      console.log(`  Batch ${batchNum}/${totalBatches} OK (${batch.length} creadas)`);
    } catch (err) {
      fallidos += batch.length;
      console.error(`  Batch ${batchNum}/${totalBatches} FALLÓ:`, err);
    }
  }

  console.log(`\n✓ Backfill completado: ${creados} CotizacionFactura creadas, ${fallidos} fallidas`);
}

main()
  .catch((e) => {
    console.error("Error fatal:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

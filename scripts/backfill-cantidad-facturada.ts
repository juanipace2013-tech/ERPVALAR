import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const isDryRun = !process.argv.includes("--apply");
const BATCH_SIZE = 50;

async function main() {
  console.log(`Modo: ${isDryRun ? "DRY RUN" : "APPLY"}\n`);

  const cotizaciones = await prisma.quote.findMany({
    where: { status: "CONVERTED" },
    include: { items: { select: { id: true, quantity: true, cantidadFacturada: true } } },
  });

  console.log(`Encontradas ${cotizaciones.length} cotizaciones en estado CONVERTED`);

  const updates: { id: string; cantidad: number }[] = [];

  for (const cot of cotizaciones) {
    for (const item of cot.items) {
      if (Number(item.cantidadFacturada) === 0) {
        updates.push({ id: item.id, cantidad: item.quantity });
      }
    }
  }

  const totalItems = cotizaciones.reduce((acc, c) => acc + c.items.length, 0);
  console.log(`Items a actualizar (cantidadFacturada = 0): ${updates.length}`);
  console.log(`Items ya con cantidadFacturada > 0 (salteados): ${totalItems - updates.length}`);

  if (updates.length === 0) {
    console.log("\nNada que actualizar.");
    return;
  }

  if (isDryRun) {
    console.log("\nDetalle:");
    for (const cot of cotizaciones) {
      const itemsToUpdate = cot.items.filter((i) => Number(i.cantidadFacturada) === 0);
      if (itemsToUpdate.length > 0) {
        console.log(`  ${cot.id} — ${itemsToUpdate.length} items`);
        for (const item of itemsToUpdate) {
          console.log(`    ${item.id}: cantidadFacturada 0 → ${item.quantity}`);
        }
      }
    }
    console.log(`\nDRY RUN — no se aplicaron cambios. Correr con --apply para ejecutar.`);
    return;
  }

  const totalBatches = Math.ceil(updates.length / BATCH_SIZE);
  let actualizados = 0;
  let fallidos = 0;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    try {
      await prisma.$transaction(
        batch.map((u) =>
          prisma.quoteItem.update({
            where: { id: u.id },
            data: { cantidadFacturada: u.cantidad },
          })
        )
      );
      actualizados += batch.length;
      console.log(`Batch ${batchNum}/${totalBatches} OK (${batch.length} items)`);
    } catch (err) {
      fallidos += batch.length;
      console.error(`Batch ${batchNum}/${totalBatches} FALLÓ:`, err);
    }
  }

  console.log(
    `\n✓ Backfill completado: ${actualizados} items actualizados, ${fallidos} fallidos en ${totalBatches} batches`
  );
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

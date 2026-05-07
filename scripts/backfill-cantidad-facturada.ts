import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const isDryRun = !process.argv.includes("--apply");

async function main() {
  console.log(`Modo: ${isDryRun ? "DRY RUN" : "APPLY"}\n`);

  const cotizaciones = await prisma.quote.findMany({
    where: { status: "CONVERTED" },
    include: { items: { select: { id: true, quantity: true, cantidadFacturada: true } } },
  });

  console.log(`Encontradas ${cotizaciones.length} cotizaciones en estado CONVERTED`);

  let totalItems = 0;
  const updates: { id: string; cantidad: number }[] = [];

  for (const cot of cotizaciones) {
    for (const item of cot.items) {
      if (Number(item.cantidadFacturada) === 0) {
        updates.push({ id: item.id, cantidad: item.quantity });
        totalItems++;
      }
    }
  }

  console.log(`Items a actualizar (cantidadFacturada = 0): ${totalItems}`);
  console.log(
    `Items ya con cantidadFacturada > 0 (salteados): ${
      cotizaciones.reduce((acc, c) => acc + c.items.length, 0) - totalItems
    }`
  );

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
    console.log("\nDRY RUN — no se aplicaron cambios. Correr con --apply para ejecutar.");
    return;
  }

  await prisma.$transaction(
    updates.map((u) =>
      prisma.quoteItem.update({
        where: { id: u.id },
        data: { cantidadFacturada: u.cantidad },
      })
    )
  );

  console.log(`\nActualizados ${totalItems} items en ${cotizaciones.length} cotizaciones.`);
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

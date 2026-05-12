import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const isDryRun = !process.argv.includes("--apply");
const BATCH_SIZE = 50;

async function main() {
  console.log(`Modo: ${isDryRun ? "DRY RUN" : "APPLY"}\n`);

  const cotizaciones = await prisma.quote.findMany({
    where: { creadoPorId: null },
    select: { id: true, quoteNumber: true, salesPersonId: true },
  });

  console.log(
    `Cotizaciones sin creadoPorId: ${cotizaciones.length}`
  );

  if (cotizaciones.length === 0) {
    console.log("\nNada que actualizar.");
    return;
  }

  if (isDryRun) {
    console.log("\nDetalle (primeras 20):");
    for (const cot of cotizaciones.slice(0, 20)) {
      console.log(
        `  ${cot.quoteNumber} → creadoPorId = ${cot.salesPersonId}`
      );
    }
    console.log("\nEjecutar con --apply para aplicar cambios.");
    return;
  }

  let updated = 0;
  for (let i = 0; i < cotizaciones.length; i += BATCH_SIZE) {
    const batch = cotizaciones.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map((cot) =>
        prisma.quote.update({
          where: { id: cot.id },
          data: { creadoPorId: cot.salesPersonId },
        })
      )
    );
    updated += batch.length;
    console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${updated}/${cotizaciones.length}`);
  }

  console.log(`\nActualizadas: ${updated} cotizaciones.`);
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

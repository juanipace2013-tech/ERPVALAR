/**
 * Import inicial del historial de viandas 2026 (ene-ago) desde las
 * planillas "TODO RICO MM-26.xlsx" de SharePoint (ALMUERZOS).
 * Datos parseados el 2026-08-25; los totales por dia se verificaron
 * contra la suma de las filas semanales de cada planilla (OJO: el
 * TOTAL de las planillas =SUM(H2:H5) omitia la 5ta semana).
 *
 * Uso (en el VPS): npx tsx scripts/import-viandas-2026.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const isDryRun = !process.argv.includes("--apply");

const DIAS: { fecha: string; cantidad: number; precio: number }[] = [
  { fecha: '2026-01-02', cantidad: 4, precio: 7000 },
  { fecha: '2026-01-05', cantidad: 5, precio: 7000 },
  { fecha: '2026-01-06', cantidad: 3, precio: 7000 },
  { fecha: '2026-01-07', cantidad: 4, precio: 7000 },
  { fecha: '2026-01-08', cantidad: 4, precio: 7000 },
  { fecha: '2026-01-09', cantidad: 4, precio: 7000 },
  { fecha: '2026-01-12', cantidad: 6, precio: 7000 },
  { fecha: '2026-01-13', cantidad: 3, precio: 7000 },
  { fecha: '2026-01-14', cantidad: 5, precio: 7000 },
  { fecha: '2026-01-15', cantidad: 5, precio: 7000 },
  { fecha: '2026-01-16', cantidad: 1, precio: 7000 },
  { fecha: '2026-01-19', cantidad: 6, precio: 7000 },
  { fecha: '2026-01-20', cantidad: 3, precio: 7000 },
  { fecha: '2026-01-21', cantidad: 6, precio: 7000 },
  { fecha: '2026-01-22', cantidad: 4, precio: 7000 },
  { fecha: '2026-01-23', cantidad: 1, precio: 7000 },
  { fecha: '2026-01-26', cantidad: 6, precio: 7000 },
  { fecha: '2026-01-27', cantidad: 4, precio: 7000 },
  { fecha: '2026-01-28', cantidad: 6, precio: 7000 },
  { fecha: '2026-01-29', cantidad: 5, precio: 7000 },
  { fecha: '2026-01-30', cantidad: 5, precio: 7000 },
  { fecha: '2026-02-02', cantidad: 4, precio: 8000 },
  { fecha: '2026-02-03', cantidad: 3, precio: 8000 },
  { fecha: '2026-02-04', cantidad: 5, precio: 8000 },
  { fecha: '2026-02-05', cantidad: 4, precio: 8000 },
  { fecha: '2026-02-06', cantidad: 5, precio: 8000 },
  { fecha: '2026-02-09', cantidad: 4, precio: 8000 },
  { fecha: '2026-02-10', cantidad: 3, precio: 8000 },
  { fecha: '2026-02-11', cantidad: 4, precio: 8000 },
  { fecha: '2026-02-12', cantidad: 3, precio: 8000 },
  { fecha: '2026-02-13', cantidad: 5, precio: 8000 },
  { fecha: '2026-02-18', cantidad: 4, precio: 8000 },
  { fecha: '2026-02-19', cantidad: 3, precio: 8000 },
  { fecha: '2026-02-20', cantidad: 5, precio: 8000 },
  { fecha: '2026-02-23', cantidad: 5, precio: 8000 },
  { fecha: '2026-02-24', cantidad: 4, precio: 8000 },
  { fecha: '2026-02-25', cantidad: 6, precio: 8000 },
  { fecha: '2026-02-26', cantidad: 5, precio: 8000 },
  { fecha: '2026-02-27', cantidad: 6, precio: 8000 },
  { fecha: '2026-03-09', cantidad: 5, precio: 8000 },
  { fecha: '2026-03-10', cantidad: 2, precio: 8000 },
  { fecha: '2026-03-11', cantidad: 5, precio: 8000 },
  { fecha: '2026-03-12', cantidad: 3, precio: 8000 },
  { fecha: '2026-03-13', cantidad: 4, precio: 8000 },
  { fecha: '2026-03-16', cantidad: 6, precio: 8000 },
  { fecha: '2026-03-17', cantidad: 3, precio: 8000 },
  { fecha: '2026-03-18', cantidad: 5, precio: 8000 },
  { fecha: '2026-03-19', cantidad: 5, precio: 8000 },
  { fecha: '2026-03-20', cantidad: 5, precio: 8000 },
  { fecha: '2026-03-25', cantidad: 5, precio: 8000 },
  { fecha: '2026-03-26', cantidad: 5, precio: 8000 },
  { fecha: '2026-03-27', cantidad: 5, precio: 8000 },
  { fecha: '2026-03-30', cantidad: 6, precio: 8000 },
  { fecha: '2026-03-31', cantidad: 3, precio: 8000 },
  { fecha: '2026-04-01', cantidad: 6, precio: 8000 },
  { fecha: '2026-04-06', cantidad: 6, precio: 8000 },
  { fecha: '2026-04-07', cantidad: 3, precio: 8000 },
  { fecha: '2026-04-08', cantidad: 5, precio: 8000 },
  { fecha: '2026-04-09', cantidad: 5, precio: 8000 },
  { fecha: '2026-04-10', cantidad: 5, precio: 8000 },
  { fecha: '2026-04-13', cantidad: 6, precio: 8000 },
  { fecha: '2026-04-14', cantidad: 3, precio: 8000 },
  { fecha: '2026-04-15', cantidad: 5, precio: 8000 },
  { fecha: '2026-04-16', cantidad: 4, precio: 8000 },
  { fecha: '2026-04-17', cantidad: 6, precio: 8000 },
  { fecha: '2026-04-20', cantidad: 3, precio: 8000 },
  { fecha: '2026-04-21', cantidad: 3, precio: 8000 },
  { fecha: '2026-04-22', cantidad: 6, precio: 8000 },
  { fecha: '2026-04-23', cantidad: 4, precio: 8000 },
  { fecha: '2026-04-24', cantidad: 5, precio: 8000 },
  { fecha: '2026-04-27', cantidad: 0, precio: 8000 },
  { fecha: '2026-04-28', cantidad: 4, precio: 8000 },
  { fecha: '2026-04-29', cantidad: 4, precio: 8000 },
  { fecha: '2026-04-30', cantidad: 4, precio: 8000 },
  { fecha: '2026-05-04', cantidad: 5, precio: 8000 },
  { fecha: '2026-05-05', cantidad: 3, precio: 8000 },
  { fecha: '2026-05-06', cantidad: 4, precio: 8000 },
  { fecha: '2026-05-07', cantidad: 4, precio: 8000 },
  { fecha: '2026-05-08', cantidad: 4, precio: 8000 },
  { fecha: '2026-05-11', cantidad: 6, precio: 8000 },
  { fecha: '2026-05-12', cantidad: 3, precio: 8000 },
  { fecha: '2026-05-13', cantidad: 6, precio: 8000 },
  { fecha: '2026-05-14', cantidad: 4, precio: 8000 },
  { fecha: '2026-05-15', cantidad: 4, precio: 8000 },
  { fecha: '2026-05-18', cantidad: 4, precio: 8000 },
  { fecha: '2026-05-19', cantidad: 2, precio: 8000 },
  { fecha: '2026-05-20', cantidad: 3, precio: 8000 },
  { fecha: '2026-05-21', cantidad: 4, precio: 8000 },
  { fecha: '2026-05-22', cantidad: 3, precio: 8000 },
  { fecha: '2026-05-26', cantidad: 4, precio: 8000 },
  { fecha: '2026-05-27', cantidad: 6, precio: 8000 },
  { fecha: '2026-05-28', cantidad: 5, precio: 8000 },
  { fecha: '2026-05-29', cantidad: 4, precio: 8000 },
  { fecha: '2026-06-01', cantidad: 6, precio: 8000 },
  { fecha: '2026-06-02', cantidad: 4, precio: 8000 },
  { fecha: '2026-06-03', cantidad: 6, precio: 8000 },
  { fecha: '2026-06-04', cantidad: 5, precio: 8000 },
  { fecha: '2026-06-05', cantidad: 6, precio: 8000 },
  { fecha: '2026-06-08', cantidad: 6, precio: 8000 },
  { fecha: '2026-06-09', cantidad: 3, precio: 8000 },
  { fecha: '2026-06-10', cantidad: 6, precio: 8000 },
  { fecha: '2026-06-11', cantidad: 5, precio: 8000 },
  { fecha: '2026-06-12', cantidad: 5, precio: 8000 },
  { fecha: '2026-06-16', cantidad: 2, precio: 8000 },
  { fecha: '2026-06-17', cantidad: 5, precio: 8000 },
  { fecha: '2026-06-18', cantidad: 3, precio: 8000 },
  { fecha: '2026-06-19', cantidad: 4, precio: 8000 },
  { fecha: '2026-06-22', cantidad: 0, precio: 8000 },
  { fecha: '2026-06-23', cantidad: 3, precio: 8000 },
  { fecha: '2026-06-24', cantidad: 3, precio: 8000 },
  { fecha: '2026-06-25', cantidad: 4, precio: 8000 },
  { fecha: '2026-06-26', cantidad: 0, precio: 8000 },
  { fecha: '2026-06-29', cantidad: 2, precio: 8000 },
  { fecha: '2026-06-30', cantidad: 2, precio: 8000 },
  { fecha: '2026-07-01', cantidad: 4, precio: 9000 },
  { fecha: '2026-07-02', cantidad: 1, precio: 9000 },
  { fecha: '2026-07-03', cantidad: 5, precio: 9000 },
  { fecha: '2026-07-06', cantidad: 3, precio: 9000 },
  { fecha: '2026-07-07', cantidad: 0, precio: 9000 },
  { fecha: '2026-07-08', cantidad: 4, precio: 9000 },
  { fecha: '2026-07-13', cantidad: 4, precio: 9000 },
  { fecha: '2026-07-14', cantidad: 3, precio: 9000 },
  { fecha: '2026-07-15', cantidad: 2, precio: 9000 },
  { fecha: '2026-07-16', cantidad: 4, precio: 9000 },
  { fecha: '2026-07-17', cantidad: 4, precio: 9000 },
  { fecha: '2026-07-20', cantidad: 3, precio: 9000 },
  { fecha: '2026-07-21', cantidad: 5, precio: 9000 },
  { fecha: '2026-07-22', cantidad: 4, precio: 9000 },
  { fecha: '2026-07-23', cantidad: 4, precio: 9000 },
  { fecha: '2026-07-24', cantidad: 4, precio: 9000 },
  { fecha: '2026-07-27', cantidad: 4, precio: 9000 },
  { fecha: '2026-07-28', cantidad: 3, precio: 9000 },
  { fecha: '2026-07-29', cantidad: 5, precio: 9000 },
  { fecha: '2026-07-30', cantidad: 3, precio: 9000 },
  { fecha: '2026-07-31', cantidad: 3, precio: 9000 },
  { fecha: '2026-08-03', cantidad: 3, precio: 9000 },
  { fecha: '2026-08-04', cantidad: 4, precio: 9000 },
  { fecha: '2026-08-05', cantidad: 4, precio: 9000 },
  { fecha: '2026-08-06', cantidad: 4, precio: 9000 },
  { fecha: '2026-08-07', cantidad: 4, precio: 9000 },
  { fecha: '2026-08-10', cantidad: 2, precio: 9000 },
  { fecha: '2026-08-11', cantidad: 4, precio: 9000 },
  { fecha: '2026-08-12', cantidad: 4, precio: 9000 },
  { fecha: '2026-08-13', cantidad: 4, precio: 9000 },
  { fecha: '2026-08-14', cantidad: 4, precio: 9000 },
  { fecha: '2026-08-18', cantidad: 3, precio: 9000 },
  { fecha: '2026-08-19', cantidad: 3, precio: 9000 },
  { fecha: '2026-08-20', cantidad: 4, precio: 9000 },
  { fecha: '2026-08-21', cantidad: 0, precio: 9000 },
  { fecha: '2026-08-24', cantidad: 3, precio: 9000 },
];

async function main() {
  console.log(`Modo: ${isDryRun ? "DRY RUN" : "APPLY"}\n`);
  console.log(`Dias a importar: ${DIAS.length}`);
  const viandas = DIAS.reduce((a, d) => a + d.cantidad, 0);
  const total = DIAS.reduce((a, d) => a + d.cantidad * d.precio, 0);
  console.log(`Total viandas: ${viandas} | Total ARS: ${total.toLocaleString("es-AR")}`);

  const existentes = await prisma.viandaDay.count();
  console.log(`Registros existentes en la tabla: ${existentes}`);

  if (isDryRun) {
    console.log("\nDry run: no se escribio nada. Correr con --apply para importar.");
    return;
  }

  for (const d of DIAS) {
    const fecha = new Date(`${d.fecha}T00:00:00.000Z`);
    await prisma.viandaDay.upsert({
      where: { fecha },
      create: { fecha, cantidad: d.cantidad, precio: d.precio },
      update: { cantidad: d.cantidad, precio: d.precio },
    });
  }
  console.log(`\nListo: ${DIAS.length} dias importados.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

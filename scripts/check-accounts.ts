import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const counts = await prisma.chartOfAccount.groupBy({
    by: ['level'],
    _count: true,
  });

  console.log('Cuentas por nivel:');
  counts.forEach(c => console.log(`  Nivel ${c.level}: ${c._count} cuentas`));

  const total = await prisma.chartOfAccount.count();
  console.log(`\nTotal: ${total} cuentas`);

  // Mostrar algunas cuentas de ejemplo
  const samples = await prisma.chartOfAccount.findMany({
    take: 5,
    orderBy: { code: 'asc' },
    select: { code: true, name: true, level: true }
  });

  console.log('\nEjemplos:');
  samples.forEach(s => console.log(`  ${s.code} - ${s.name} (Nivel ${s.level})`));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

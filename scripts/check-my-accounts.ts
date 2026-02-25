import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const testCodes = ['1.1.1', '1.1.1.001', '2.1.2.001', '5.1.1.001'];

  console.log('Verificando cuentas específicas del seed:\n');

  for (const code of testCodes) {
    const account = await prisma.chartOfAccount.findUnique({
      where: { code }
    });

    if (account) {
      console.log(`✓ ${code} - ${account.name}`);
    } else {
      console.log(`✗ ${code} - NO ENCONTRADA`);
    }
  }

  console.log('\n--- Verificando estructura de Caja y Bancos ---');
  const cajaYBancos = await prisma.chartOfAccount.findMany({
    where: {
      OR: [
        { code: { startsWith: '1.1.1' } },
        { code: { startsWith: '1.1.01' } }
      ]
    },
    orderBy: { code: 'asc' },
    select: { code: true, name: true, category: true }
  });

  cajaYBancos.forEach(acc => {
    console.log(`  ${acc.code} - ${acc.name} (${acc.category || 'sin categoría'})`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

/**
 * Verifica que no queden cuentas del sistema antiguo
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyNoOldAccounts() {
  console.log('🔍 VERIFICANDO QUE NO EXISTAN CUENTAS DEL SISTEMA ANTIGUO\n');
  console.log('═'.repeat(70));

  try {
    const allAccounts = await prisma.chartOfAccount.findMany({
      select: { code: true, name: true },
      orderBy: { code: 'asc' },
    });

    // Patrones del sistema antiguo (sin ceros en el último segmento)
    const oldSystemPatterns = [
      /^1\\.1\\.1$/,
      /^1\\.1\\.2$/,
      /^1\\.1\\.3$/,
      /^1\\.1\\.4$/,
      /^1\\.2\\.1$/,
      /^2\\.1\\.1$/,
      /^2\\.1\\.2$/,
      /^2\\.1\\.3$/,
      /^2\\.1\\.4$/,
      /^2\\.2\\.1$/,
      /^3\\.1\\.1$/,
      /^3\\.2\\.1$/,
      /^4\\.1\\.1$/,
      /^5\\.1\\.1$/,
      /^5\\.2\\.1$/,
      /^5\\.2\\.2$/,
      // Subcuentas del sistema antiguo
      /^1\\.1\\.1\\.\\d{3}$/,
      /^1\\.1\\.2\\.\\d{3}$/,
      /^1\\.1\\.3\\.\\d{3}$/,
      /^1\\.1\\.4\\.\\d{3}$/,
      /^1\\.2\\.1\\.\\d{3}$/,
      /^2\\.1\\.1\\.\\d{3}$/,
      /^2\\.1\\.2\\.\\d{3}$/,
      /^2\\.1\\.3\\.\\d{3}$/,
      /^2\\.1\\.4\\.\\d{3}$/,
      /^2\\.2\\.1\\.\\d{3}$/,
    ];

    const oldAccounts = allAccounts.filter((acc) =>
      oldSystemPatterns.some((pattern) => pattern.test(acc.code))
    );

    if (oldAccounts.length === 0) {
      console.log('✅ PERFECTO: No se encontraron cuentas del sistema antiguo\n');
      console.log(`Total de cuentas en el sistema: ${allAccounts.length}`);
      console.log('\nEjemplos de cuentas actuales (sistema nuevo con ceros):');
      allAccounts.slice(0, 10).forEach((acc) => {
        console.log(`   - ${acc.code.padEnd(15)} ${acc.name}`);
      });
    } else {
      console.log(`❌ ADVERTENCIA: Se encontraron ${oldAccounts.length} cuentas del sistema antiguo:\n`);
      oldAccounts.forEach((acc) => {
        console.log(`   - ${acc.code.padEnd(15)} ${acc.name}`);
      });
    }
  } catch (error) {
    console.error('❌ ERROR:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

verifyNoOldAccounts()
  .then(() => {
    console.log('\n✅ Verificación completada\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Verificación falló:', error);
    process.exit(1);
  });

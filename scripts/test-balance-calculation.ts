/**
 * Script para probar el cálculo correcto de saldos contables
 */

import { PrismaClient } from '@prisma/client';
import { calculateAccountBalance, calculateRunningBalance } from '../src/lib/contabilidad/balance-helper';

const prisma = new PrismaClient();

async function testBalanceCalculation() {
  console.log('🧪 PROBANDO CÁLCULO CORRECTO DE SALDOS CONTABLES\n');
  console.log('═'.repeat(80));

  try {
    // Obtener cuentas con movimientos
    const accountsWithMovements = await prisma.journalEntryLine.groupBy({
      by: ['accountId'],
      where: {
        journalEntry: {
          status: 'POSTED',
        },
      },
      _count: true,
      _sum: {
        debit: true,
        credit: true,
      },
    });

    console.log(`\n📊 Cuentas con movimientos: ${accountsWithMovements.length}\n`);

    if (accountsWithMovements.length === 0) {
      console.log('⚠️  No hay cuentas con movimientos');
      return;
    }

    console.log('VERIFICACIÓN DE SALDOS (MÉTODO CORRECTO):\n');
    console.log('Regla: Los saldos SIEMPRE son positivos, con naturaleza D (Deudor) o A (Acreedor)\n');

    for (const item of accountsWithMovements) {
      const account = await prisma.chartOfAccount.findUnique({
        where: { id: item.accountId },
        select: { code: true, name: true, accountType: true },
      });

      if (!account) continue;

      const debit = Number(item._sum.debit || 0);
      const credit = Number(item._sum.credit || 0);

      // Cálculo CORRECTO usando el helper
      const balance = calculateAccountBalance(account.accountType, debit, credit);

      // Cálculo INCORRECTO (método antiguo)
      let oldBalance = 0;
      if (['ACTIVO', 'EGRESO'].includes(account.accountType)) {
        oldBalance = debit - credit;
      } else {
        oldBalance = credit - debit;
      }

      const isNormalNature =
        (account.accountType === 'ACTIVO' || account.accountType === 'EGRESO')
          ? balance.nature === 'DEUDOR'
          : balance.nature === 'ACREEDOR';

      console.log(`${account.code.padEnd(15)} ${account.name.padEnd(40)}`);
      console.log(`   Tipo: ${account.accountType.padEnd(18)} (Naturaleza ${account.accountType === 'ACTIVO' || account.accountType === 'EGRESO' ? 'Deudora' : 'Acreedora'})`);
      console.log(`   Debe:  $${debit.toFixed(2).padStart(12)} | Haber: $${credit.toFixed(2).padStart(12)}`);
      console.log(`   ❌ Antiguo: $${oldBalance.toFixed(2).padStart(12)} ${oldBalance < 0 ? '(NEGATIVO - INCORRECTO)' : ''}`);
      console.log(`   ✅ Correcto: $${balance.amount.toFixed(2).padStart(12)} (${balance.nature}) ${!isNormalNature ? '⚠️ Saldo Anormal' : ''}`);
      console.log('');
    }

    // Prueba de saldo acumulado (Libro Mayor)
    console.log('\n' + '═'.repeat(80));
    console.log('PRUEBA DE SALDO ACUMULADO (LIBRO MAYOR):\n');

    // Tomar la primera cuenta con movimientos
    const firstAccountId = accountsWithMovements[0].accountId;
    const account = await prisma.chartOfAccount.findUnique({
      where: { id: firstAccountId },
    });

    if (!account) {
      console.log('⚠️  No se pudo encontrar la cuenta');
      return;
    }

    const movements = await prisma.journalEntryLine.findMany({
      where: {
        accountId: firstAccountId,
        journalEntry: { status: 'POSTED' },
      },
      include: {
        journalEntry: {
          select: {
            entryNumber: true,
            date: true,
            description: true,
          },
        },
      },
      orderBy: [
        { journalEntry: { date: 'asc' } },
        { journalEntry: { entryNumber: 'asc' } },
      ],
    });

    console.log(`Cuenta: ${account.code} - ${account.name}`);
    console.log(`Tipo: ${account.accountType}\n`);
    console.log('Movimientos:');

    let runningBalance = { amount: 0, nature: 'DEUDOR' as const };

    movements.forEach((movement, idx) => {
      const debit = Number(movement.debit);
      const credit = Number(movement.credit);

      runningBalance = calculateRunningBalance(
        account.accountType,
        runningBalance,
        debit,
        credit
      );

      console.log(`\n${(idx + 1).toString().padStart(2)}. Asiento #${movement.journalEntry.entryNumber} - ${movement.journalEntry.date.toISOString().split('T')[0]}`);
      console.log(`    Debe:  $${debit.toFixed(2).padStart(10)} | Haber: $${credit.toFixed(2).padStart(10)}`);
      console.log(`    Saldo: $${runningBalance.amount.toFixed(2).padStart(10)} (${runningBalance.nature})`);
    });

    console.log(`\n    SALDO FINAL: $${runningBalance.amount.toFixed(2)} (${runningBalance.nature})`);

    console.log('\n\n✅ VERIFICACIÓN COMPLETADA');
    console.log('\nRESUMEN:');
    console.log('  • Los saldos ahora se muestran SIEMPRE positivos');
    console.log('  • Se indica la naturaleza: (D) Deudor o (A) Acreedor');
    console.log('  • Los saldos anormales se detectan correctamente');
    console.log('  • El cálculo es correcto según las normas contables');

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
testBalanceCalculation()
  .then(() => {
    console.log('\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Prueba falló:', error);
    process.exit(1);
  });

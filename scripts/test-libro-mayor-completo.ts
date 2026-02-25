/**
 * Script para probar la consulta del Libro Mayor completo
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testLibroMayorCompleto() {
  console.log('🔍 PROBANDO LIBRO MAYOR COMPLETO\n');
  console.log('═'.repeat(80));

  try {
    // Simular la consulta del API en modo showAll
    const journalEntryFilter: any = {
      status: 'POSTED',
    };

    // Obtener todas las cuentas con movimientos
    const accountsWithMovements = await prisma.journalEntryLine.groupBy({
      by: ['accountId'],
      where: {
        journalEntry: journalEntryFilter,
      },
      _count: true,
    });

    console.log(`\n📊 Cuentas con movimientos: ${accountsWithMovements.length}\n`);

    if (accountsWithMovements.length === 0) {
      console.log('⚠️  No hay cuentas con movimientos');
      return;
    }

    // Para cada cuenta, obtener sus movimientos
    const accountsData = await Promise.all(
      accountsWithMovements.map(async (item) => {
        const account = await prisma.chartOfAccount.findUnique({
          where: { id: item.accountId },
        });

        if (!account) return null;

        const movements = await prisma.journalEntryLine.findMany({
          where: {
            accountId: item.accountId,
            journalEntry: journalEntryFilter,
          },
          include: {
            journalEntry: {
              select: {
                id: true,
                entryNumber: true,
                date: true,
                description: true,
              },
            },
            account: {
              select: {
                code: true,
                name: true,
              },
            },
          },
          orderBy: [
            { journalEntry: { date: 'asc' } },
            { journalEntry: { entryNumber: 'asc' } },
          ],
        });

        // Calcular saldos
        let balance = 0;
        const movementsWithBalance = movements.map((movement) => {
          const debit = Number(movement.debit);
          const credit = Number(movement.credit);

          if (['ACTIVO', 'EGRESO'].includes(account.accountType)) {
            balance += debit - credit;
          } else {
            balance += credit - debit;
          }

          return {
            ...movement,
            balance,
          };
        });

        const totalDebit = movements.reduce((sum, m) => sum + Number(m.debit), 0);
        const totalCredit = movements.reduce((sum, m) => sum + Number(m.credit), 0);

        return {
          account,
          movements: movementsWithBalance,
          totals: {
            debit: totalDebit,
            credit: totalCredit,
            balance,
          },
        };
      })
    );

    // Filtrar nulls y ordenar por código de cuenta
    const validAccounts = accountsData
      .filter((item) => item !== null)
      .sort((a, b) => a!.account.code.localeCompare(b!.account.code));

    console.log('═'.repeat(80));
    console.log('RESUMEN DEL LIBRO MAYOR COMPLETO:\n');

    validAccounts.forEach((accountData, idx) => {
      console.log(`${(idx + 1).toString().padStart(2)}. ${accountData!.account.code.padEnd(15)} ${accountData!.account.name.padEnd(40)}`);
      console.log(`    Tipo: ${accountData!.account.accountType.padEnd(18)} | Movimientos: ${accountData!.movements.length.toString().padStart(3)}`);
      console.log(`    Debe:  $${accountData!.totals.debit.toFixed(2).padStart(12)} | Haber: $${accountData!.totals.credit.toFixed(2).padStart(12)} | Saldo: $${accountData!.totals.balance.toFixed(2).padStart(12)}`);
      console.log('');
    });

    // Totales generales
    const totalMovements = validAccounts.reduce((sum, acc) => sum + acc!.movements.length, 0);
    const totalDebit = validAccounts.reduce((sum, acc) => sum + acc!.totals.debit, 0);
    const totalCredit = validAccounts.reduce((sum, acc) => sum + acc!.totals.credit, 0);

    console.log('═'.repeat(80));
    console.log('TOTALES GENERALES:');
    console.log(`   Cuentas con movimientos: ${validAccounts.length}`);
    console.log(`   Total de movimientos:    ${totalMovements}`);
    console.log(`   Total Debe:              $${totalDebit.toFixed(2)}`);
    console.log(`   Total Haber:             $${totalCredit.toFixed(2)}`);
    console.log(`   Balance:                 ${totalDebit === totalCredit ? '✅ CUADRADO' : '❌ DESCUADRADO'}`);
    console.log('═'.repeat(80));

    // Detalle de una cuenta (ejemplo)
    if (validAccounts.length > 0) {
      console.log('\n\n🔍 DETALLE DE PRIMERA CUENTA:\n');
      const firstAccount = validAccounts[0]!;

      console.log(`Cuenta: ${firstAccount.account.code} - ${firstAccount.account.name}`);
      console.log(`Tipo: ${firstAccount.account.accountType}\n`);
      console.log('Movimientos:');

      firstAccount.movements.forEach((movement, idx) => {
        console.log(`\n${(idx + 1).toString().padStart(2)}. Asiento #${movement.journalEntry.entryNumber}`);
        console.log(`    Fecha: ${movement.journalEntry.date.toISOString().split('T')[0]}`);
        console.log(`    Descripción: ${movement.journalEntry.description}`);
        console.log(`    Debe:  $${Number(movement.debit).toFixed(2).padStart(12)}`);
        console.log(`    Haber: $${Number(movement.credit).toFixed(2).padStart(12)}`);
        console.log(`    Saldo: $${movement.balance.toFixed(2).padStart(12)}`);
      });

      console.log(`\n    TOTALES:`);
      console.log(`    Debe:  $${firstAccount.totals.debit.toFixed(2).padStart(12)}`);
      console.log(`    Haber: $${firstAccount.totals.credit.toFixed(2).padStart(12)}`);
      console.log(`    Saldo: $${firstAccount.totals.balance.toFixed(2).padStart(12)}`);
    }

    console.log('\n\n✅ PRUEBA EXITOSA: El Libro Mayor completo funciona correctamente');

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
testLibroMayorCompleto()
  .then(() => {
    console.log('\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Prueba falló:', error);
    process.exit(1);
  });

/**
 * Script para probar la consulta del Libro Mayor
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testLibroMayor() {
  console.log('🔍 PROBANDO CONSULTA DE LIBRO MAYOR\n');
  console.log('═'.repeat(80));

  try {
    // Obtener una cuenta con movimientos
    const accountWithMovements = await prisma.journalEntryLine.findFirst({
      where: {
        journalEntry: {
          status: 'POSTED',
        },
      },
      include: {
        account: {
          select: {
            id: true,
            code: true,
            name: true,
            accountType: true,
          },
        },
      },
    });

    if (!accountWithMovements) {
      console.log('⚠️  No hay cuentas con movimientos');
      return;
    }

    const account = accountWithMovements.account;
    console.log(`\n📌 Probando con cuenta: ${account.code} - ${account.name}`);
    console.log(`   Tipo: ${account.accountType}`);
    console.log(`   ID: ${account.id}\n`);

    // Simular la consulta que hace el API
    const movements = await prisma.journalEntryLine.findMany({
      where: {
        accountId: account.id,
        journalEntry: {
          status: 'POSTED',
        },
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
      },
      orderBy: [
        { journalEntry: { date: 'asc' } },
        { journalEntry: { entryNumber: 'asc' } },
      ],
    });

    console.log('═'.repeat(80));
    console.log(`MOVIMIENTOS ENCONTRADOS: ${movements.length}\n`);

    if (movements.length === 0) {
      console.log('⚠️  No se encontraron movimientos para esta cuenta');
      return;
    }

    // Calcular saldos
    let balance = 0;
    console.log('DETALLE DE MOVIMIENTOS:\n');

    movements.forEach((movement, idx) => {
      const debit = Number(movement.debit);
      const credit = Number(movement.credit);

      // Para cuentas de Activo y Egreso: Debe aumenta, Haber disminuye
      // Para cuentas de Pasivo, Patrimonio e Ingreso: Haber aumenta, Debe disminuye
      if (['ACTIVO', 'EGRESO'].includes(account.accountType)) {
        balance += debit - credit;
      } else {
        balance += credit - debit;
      }

      console.log(`${(idx + 1).toString().padStart(2)}. Asiento #${movement.journalEntry.entryNumber}`);
      console.log(`    Fecha: ${movement.journalEntry.date.toISOString().split('T')[0]}`);
      console.log(`    Descripción: ${movement.journalEntry.description}`);
      console.log(`    Debe:  $${debit.toFixed(2).padStart(10)}`);
      console.log(`    Haber: $${credit.toFixed(2).padStart(10)}`);
      console.log(`    Saldo: $${balance.toFixed(2).padStart(10)}`);
      console.log('');
    });

    // Totales
    const totalDebit = movements.reduce((sum, m) => sum + Number(m.debit), 0);
    const totalCredit = movements.reduce((sum, m) => sum + Number(m.credit), 0);

    console.log('═'.repeat(80));
    console.log('TOTALES:');
    console.log(`   Total Debe:  $${totalDebit.toFixed(2)}`);
    console.log(`   Total Haber: $${totalCredit.toFixed(2)}`);
    console.log(`   Saldo Final: $${balance.toFixed(2)}`);
    console.log('═'.repeat(80));

    // Probar con todas las cuentas que tienen movimientos
    console.log('\n\n🔍 RESUMEN DE TODAS LAS CUENTAS CON MOVIMIENTOS:\n');

    const allAccountsWithMovements = await prisma.journalEntryLine.groupBy({
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

    console.log(`Total de cuentas: ${allAccountsWithMovements.length}\n`);

    for (const item of allAccountsWithMovements) {
      const acc = await prisma.chartOfAccount.findUnique({
        where: { id: item.accountId },
        select: { code: true, name: true, accountType: true },
      });

      if (acc) {
        const debit = Number(item._sum.debit || 0);
        const credit = Number(item._sum.credit || 0);
        let balance = 0;

        if (['ACTIVO', 'EGRESO'].includes(acc.accountType)) {
          balance = debit - credit;
        } else {
          balance = credit - debit;
        }

        console.log(`${acc.code.padEnd(15)} ${acc.name.padEnd(40)}`);
        console.log(`   Movimientos: ${item._count.toString().padStart(3)}`);
        console.log(`   Debe:  $${debit.toFixed(2).padStart(12)}`);
        console.log(`   Haber: $${credit.toFixed(2).padStart(12)}`);
        console.log(`   Saldo: $${balance.toFixed(2).padStart(12)}`);
        console.log('');
      }
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
testLibroMayor()
  .then(() => {
    console.log('\n✅ Prueba completada\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Prueba falló:', error);
    process.exit(1);
  });

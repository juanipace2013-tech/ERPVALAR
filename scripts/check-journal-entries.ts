/**
 * Script para verificar asientos contables y sus estados
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkJournalEntries() {
  console.log('🔍 VERIFICANDO ASIENTOS CONTABLES\n');
  console.log('═'.repeat(80));

  try {
    // Obtener todos los asientos
    const allEntries = await prisma.journalEntry.findMany({
      select: {
        id: true,
        entryNumber: true,
        date: true,
        description: true,
        status: true,
        isAutomatic: true,
        templateCode: true,
        triggerType: true,
        invoiceId: true,
        _count: {
          select: { lines: true },
        },
      },
      orderBy: { entryNumber: 'desc' },
      take: 20,
    });

    console.log(`\n📊 Total de asientos (últimos 20): ${allEntries.length}\n`);

    if (allEntries.length === 0) {
      console.log('⚠️  No hay asientos contables en el sistema');
      return;
    }

    // Agrupar por estado
    const byStatus = {
      DRAFT: allEntries.filter(e => e.status === 'DRAFT'),
      POSTED: allEntries.filter(e => e.status === 'POSTED'),
    };

    console.log('📈 RESUMEN POR ESTADO:');
    console.log(`   DRAFT (Borrador):   ${byStatus.DRAFT.length} asientos`);
    console.log(`   POSTED (Confirmado): ${byStatus.POSTED.length} asientos`);

    // Mostrar detalles de cada asiento
    console.log('\n' + '═'.repeat(80));
    console.log('DETALLE DE ASIENTOS (últimos 20):\n');

    allEntries.forEach((entry) => {
      const statusBadge = entry.status === 'POSTED' ? '✅ POSTED' : '📝 DRAFT';
      const autoBadge = entry.isAutomatic ? '🤖 AUTO' : '👤 MANUAL';

      console.log(`\n📋 Asiento #${entry.entryNumber} - ${statusBadge} ${autoBadge}`);
      console.log(`   ID: ${entry.id.substring(0, 16)}...`);
      console.log(`   Fecha: ${entry.date.toISOString().split('T')[0]}`);
      console.log(`   Descripción: ${entry.description}`);
      if (entry.templateCode) {
        console.log(`   Plantilla: ${entry.templateCode}`);
      }
      if (entry.triggerType) {
        console.log(`   Trigger: ${entry.triggerType}`);
      }
      if (entry.invoiceId) {
        console.log(`   Factura: ${entry.invoiceId.substring(0, 16)}...`);
      }
      console.log(`   Líneas: ${entry._count.lines}`);
    });

    // Verificar asientos con líneas
    console.log('\n' + '═'.repeat(80));
    console.log('VERIFICANDO LÍNEAS DE ASIENTOS:\n');

    const entriesWithLines = await prisma.journalEntry.findMany({
      where: {
        status: 'POSTED',
      },
      include: {
        lines: {
          include: {
            account: {
              select: {
                code: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { entryNumber: 'desc' },
      take: 5,
    });

    if (entriesWithLines.length === 0) {
      console.log('⚠️  No hay asientos POSTED en el sistema');
    } else {
      console.log(`\n📊 Mostrando detalles de los últimos ${entriesWithLines.length} asientos POSTED:\n`);

      entriesWithLines.forEach((entry) => {
        console.log(`\n═══ Asiento #${entry.entryNumber} ═══`);
        console.log(`Fecha: ${entry.date.toISOString().split('T')[0]}`);
        console.log(`Descripción: ${entry.description}`);
        console.log(`\nLíneas:`);

        let totalDebit = 0;
        let totalCredit = 0;

        entry.lines.forEach((line, idx) => {
          const debit = Number(line.debit);
          const credit = Number(line.credit);
          totalDebit += debit;
          totalCredit += credit;

          console.log(
            `   ${idx + 1}. ${line.account.code.padEnd(12)} ${line.account.name.padEnd(30)} ` +
            `D: ${debit.toFixed(2).padStart(10)} ` +
            `H: ${credit.toFixed(2).padStart(10)}`
          );
        });

        console.log(`\n   TOTALES: ${''.padEnd(43)} D: ${totalDebit.toFixed(2).padStart(10)} H: ${totalCredit.toFixed(2).padStart(10)}`);
        console.log(`   Balance: ${totalDebit === totalCredit ? '✅ OK' : '❌ DESBALANCEADO'}`);
      });
    }

    // Verificar cuentas con movimientos
    console.log('\n' + '═'.repeat(80));
    console.log('CUENTAS CON MOVIMIENTOS:\n');

    const accountsWithMovements = await prisma.journalEntryLine.groupBy({
      by: ['accountId'],
      where: {
        journalEntry: {
          status: 'POSTED',
        },
      },
      _count: true,
    });

    console.log(`Total de cuentas con movimientos: ${accountsWithMovements.length}`);

    if (accountsWithMovements.length > 0) {
      console.log('\nTop 10 cuentas con más movimientos:');

      const accountsWithDetails = await Promise.all(
        accountsWithMovements.slice(0, 10).map(async (item) => {
          const account = await prisma.chartOfAccount.findUnique({
            where: { id: item.accountId },
            select: { code: true, name: true },
          });
          return {
            ...item,
            account,
          };
        })
      );

      accountsWithDetails
        .sort((a, b) => b._count - a._count)
        .forEach((item, idx) => {
          console.log(
            `   ${(idx + 1).toString().padStart(2)}. ${item.account?.code.padEnd(12)} ${item.account?.name.padEnd(40)} (${item._count} movimientos)`
          );
        });
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
checkJournalEntries()
  .then(() => {
    console.log('\n\n✅ Verificación completada\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Verificación falló:', error);
    process.exit(1);
  });

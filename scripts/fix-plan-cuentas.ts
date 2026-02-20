/**
 * Script para limpiar plan de cuentas y actualizar plantillas
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixPlanCuentas() {
  console.log('🔧 LIMPIANDO PLAN DE CUENTAS Y ACTUALIZANDO PLANTILLAS\n');

  try {
    // 1. Identificar y eliminar duplicados
    console.log('📋 PASO 1: Identificar duplicados');
    console.log('═'.repeat(70));

    const allAccounts = await prisma.chartOfAccount.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        isDetailAccount: true,
        createdAt: true,
      },
    });

    // Agrupar por código
    const grouped: Record<string, typeof allAccounts> = {};
    allAccounts.forEach((acc) => {
      if (!grouped[acc.code]) {
        grouped[acc.code] = [];
      }
      grouped[acc.code].push(acc);
    });

    // Identificar duplicados
    const duplicates: string[] = [];
    Object.keys(grouped).forEach((code) => {
      if (grouped[code].length > 1) {
        duplicates.push(code);
        console.log(`\n❌ DUPLICADO: ${code} - ${grouped[code][0].name}`);
        grouped[code].forEach((acc, i) => {
          console.log(
            `   [${i + 1}] ID: ${acc.id.substring(0, 12)}... ` +
              `(${acc.createdAt.toISOString().substring(0, 10)}) ` +
              `${acc.isDetailAccount ? '✓ Detalle' : 'Grupo'}`
          );
        });
      }
    });

    console.log(`\n\nTotal cuentas: ${allAccounts.length}`);
    console.log(`Cuentas duplicadas: ${duplicates.length}`);

    // 2. Eliminar duplicados (mantener el más antiguo que sea cuenta de detalle)
    console.log('\n\n📋 PASO 2: Eliminar duplicados');
    console.log('═'.repeat(70));

    for (const code of duplicates) {
      const accounts = grouped[code];

      // Preferir cuenta de detalle, si no, la más antigua
      const toKeep =
        accounts.find((a) => a.isDetailAccount) || accounts[0];
      const toDelete = accounts.filter((a) => a.id !== toKeep.id);

      console.log(`\n✓ Manteniendo: ${code} (ID: ${toKeep.id.substring(0, 12)}...)`);

      for (const acc of toDelete) {
        try {
          // Verificar si tiene relaciones
          const hasLines = await prisma.journalEntryTemplateLine.count({
            where: { accountId: acc.id },
          });

          if (hasLines > 0) {
            console.log(
              `   ⚠️  Cuenta ${acc.id.substring(0, 12)}... tiene ${hasLines} líneas de plantilla - actualizando...`
            );
            // Actualizar referencias a la cuenta correcta
            await prisma.journalEntryTemplateLine.updateMany({
              where: { accountId: acc.id },
              data: { accountId: toKeep.id },
            });
          }

          // Ahora eliminar la cuenta duplicada
          await prisma.chartOfAccount.delete({
            where: { id: acc.id },
          });
          console.log(`   ✓ Eliminado: ${acc.id.substring(0, 12)}...`);
        } catch (error) {
          console.log(
            `   ❌ No se pudo eliminar ${acc.id.substring(0, 12)}...: ${error instanceof Error ? error.message : 'Error desconocido'}`
          );
        }
      }
    }

    // 3. Marcar cuentas necesarias como detalle
    console.log('\n\n📋 PASO 3: Marcar cuentas como detalle');
    console.log('═'.repeat(70));

    const accountsToMakeDetail = [
      '1.1.01.001', // Caja
      '1.1.01.002', // Banco / Caja Chica
      '1.1.03', // Créditos por Ventas
      '1.1.04.002', // Retenciones y Percepciones
      '1.1.05.001', // Mercaderías
      '2.1.01', // Deudas Comerciales
      '2.1.03.001', // Sueldos a Pagar
      '2.1.04.001', // Préstamos Bancarios (o IVA)
      '2.2.01.001', // Préstamos a Largo Plazo
      '4.1.01', // Ventas
      '5.1.01', // CMV
    ];

    for (const code of accountsToMakeDetail) {
      const account = await prisma.chartOfAccount.findUnique({
        where: { code },
      });

      if (account) {
        await prisma.chartOfAccount.update({
          where: { code },
          data: {
            isDetailAccount: true,
            acceptsEntries: true,
          },
        });
        console.log(`✓ ${code} - ${account.name} → Cuenta de detalle`);
      } else {
        console.log(`⚠️  ${code} - No encontrada`);
      }
    }

    // 4. Verificar plantillas
    console.log('\n\n📋 PASO 4: Verificar plantillas');
    console.log('═'.repeat(70));

    const templates = await prisma.journalEntryTemplate.findMany({
      where: { isActive: true },
      include: {
        lines: {
          include: {
            account: {
              select: { code: true, name: true, isDetailAccount: true },
            },
          },
        },
      },
    });

    console.log(`\nPlantillas activas: ${templates.length}\n`);

    let errorsFound = 0;
    for (const template of templates) {
      console.log(`📝 ${template.code} - ${template.name}`);
      for (const line of template.lines) {
        const status = line.account.isDetailAccount ? '✓' : '❌';
        console.log(
          `   ${status} ${line.account.code} - ${line.account.name}`
        );
        if (!line.account.isDetailAccount) {
          errorsFound++;
        }
      }
    }

    if (errorsFound > 0) {
      console.log(`\n⚠️  ${errorsFound} líneas con cuentas que no son de detalle`);
    } else {
      console.log('\n✅ Todas las plantillas usan cuentas de detalle correctamente');
    }

    // 5. Resumen final
    console.log('\n\n✅ RESUMEN FINAL');
    console.log('═'.repeat(70));

    const finalCount = await prisma.chartOfAccount.count();
    console.log(`✓ Cuentas totales: ${finalCount}`);
    console.log(`✓ Duplicados eliminados: ${duplicates.length}`);
    console.log(`✓ Cuentas marcadas como detalle: ${accountsToMakeDetail.length}`);
    console.log(`✓ Plantillas activas: ${templates.length}`);
    console.log('\n🎉 Plan de cuentas limpiado y plantillas verificadas');

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
fixPlanCuentas()
  .then(() => {
    console.log('\n✅ Script completado exitosamente\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script falló:', error);
    process.exit(1);
  });

/**
 * Script para identificar y eliminar cuentas duplicadas en el plan de cuentas
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function removeDuplicates() {
  console.log('🔍 BUSCANDO DUPLICADOS EN PLAN DE CUENTAS\n');

  try {
    // Obtener todas las cuentas
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

    console.log(`Total de cuentas: ${allAccounts.length}\n`);

    // Buscar duplicados por código
    const byCode: Record<string, typeof allAccounts> = {};
    allAccounts.forEach((acc) => {
      if (!byCode[acc.code]) {
        byCode[acc.code] = [];
      }
      byCode[acc.code].push(acc);
    });

    const duplicatesByCode = Object.keys(byCode).filter(
      (code) => byCode[code].length > 1
    );

    console.log('═'.repeat(70));
    console.log('DUPLICADOS POR CÓDIGO');
    console.log('═'.repeat(70));

    if (duplicatesByCode.length === 0) {
      console.log('✅ No se encontraron duplicados por código\n');
    } else {
      console.log(`❌ Se encontraron ${duplicatesByCode.length} códigos duplicados:\n`);

      let totalRemoved = 0;

      for (const code of duplicatesByCode) {
        const accounts = byCode[code];
        console.log(`\n📍 Código: ${code} (${accounts.length} duplicados)`);

        // Preferir: 1. Cuenta de detalle, 2. Más antigua
        const toKeep =
          accounts.find((a) => a.isDetailAccount) ||
          accounts.sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
          )[0];

        const toDelete = accounts.filter((a) => a.id !== toKeep.id);

        console.log(
          `   ✓ Manteniendo: ${toKeep.id.substring(0, 12)}... ` +
            `(${toKeep.createdAt.toISOString().substring(0, 10)}) ` +
            `${toKeep.isDetailAccount ? '[Detalle]' : '[Grupo]'}`
        );

        for (const acc of toDelete) {
          try {
            // Verificar relaciones
            const [hasLines, hasTemplateLines] = await Promise.all([
              prisma.journalEntryLine.count({ where: { accountId: acc.id } }),
              prisma.journalEntryTemplateLine.count({ where: { accountId: acc.id } }),
            ]);

            if (hasLines > 0) {
              console.log(
                `   ⚠️  ${acc.id.substring(0, 12)}... tiene ${hasLines} asientos - actualizando a cuenta correcta...`
              );
              await prisma.journalEntryLine.updateMany({
                where: { accountId: acc.id },
                data: { accountId: toKeep.id },
              });
            }

            if (hasTemplateLines > 0) {
              console.log(
                `   ⚠️  ${acc.id.substring(0, 12)}... tiene ${hasTemplateLines} líneas de plantilla - actualizando...`
              );
              await prisma.journalEntryTemplateLine.updateMany({
                where: { accountId: acc.id },
                data: { accountId: toKeep.id },
              });
            }

            // Eliminar
            await prisma.chartOfAccount.delete({ where: { id: acc.id } });
            console.log(
              `   ✓ Eliminado: ${acc.id.substring(0, 12)}... ` +
                `(${acc.createdAt.toISOString().substring(0, 10)})`
            );
            totalRemoved++;
          } catch (error) {
            console.log(
              `   ❌ Error al eliminar ${acc.id.substring(0, 12)}...: ${error instanceof Error ? error.message : 'Error desconocido'}`
            );
          }
        }
      }

      console.log(`\n✅ Total de cuentas duplicadas eliminadas: ${totalRemoved}`);
    }

    // Buscar duplicados por nombre
    console.log('\n' + '═'.repeat(70));
    console.log('DUPLICADOS POR NOMBRE');
    console.log('═'.repeat(70));

    const byName: Record<string, typeof allAccounts> = {};
    allAccounts.forEach((acc) => {
      const normalized = acc.name.trim().toLowerCase();
      if (!byName[normalized]) {
        byName[normalized] = [];
      }
      byName[normalized].push(acc);
    });

    const duplicatesByName = Object.keys(byName).filter(
      (name) => byName[name].length > 1
    );

    if (duplicatesByName.length === 0) {
      console.log('✅ No se encontraron duplicados por nombre\n');
    } else {
      console.log(
        `⚠️  Se encontraron ${duplicatesByName.length} nombres duplicados (requieren revisión manual):\n`
      );

      duplicatesByName.slice(0, 20).forEach((name) => {
        console.log(`\n"${name}":`);
        byName[name].forEach((acc) => {
          console.log(
            `   - ${acc.code.padEnd(15)} (ID: ${acc.id.substring(0, 12)}...)`
          );
        });
      });

      if (duplicatesByName.length > 20) {
        console.log(`\n... y ${duplicatesByName.length - 20} más`);
      }

      console.log(
        '\n💡 Estos duplicados por nombre tienen códigos diferentes.'
      );
      console.log('   Revísalos manualmente desde la interfaz para decidir si eliminarlos.');
    }

    // Resumen final
    const finalCount = await prisma.chartOfAccount.count();

    console.log('\n' + '═'.repeat(70));
    console.log('RESUMEN FINAL');
    console.log('═'.repeat(70));
    console.log(`✅ Total de cuentas: ${allAccounts.length} → ${finalCount}`);
    console.log(`✅ Cuentas eliminadas: ${allAccounts.length - finalCount}`);
    console.log(`✅ Plan de cuentas limpiado`);
  } catch (error) {
    console.error('\n❌ ERROR:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
removeDuplicates()
  .then(() => {
    console.log('\n🎉 Script completado exitosamente\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script falló:', error);
    process.exit(1);
  });

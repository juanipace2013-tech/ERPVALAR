/**
 * Script para eliminar cuentas del sistema de numeración antiguo (sin ceros)
 * Elimina: 1.1.1, 1.1.2, 1.2.1, 2.1.1, 2.1.2, 2.2.1, 3.1.1, 3.2.1, etc.
 * Mantiene: 1.1.01, 1.1.02, 1.2.01, 2.1.01, etc.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deleteOldNumberingSystem() {
  console.log('🗑️  ELIMINANDO CUENTAS DEL SISTEMA ANTIGUO (SIN CEROS)\n');
  console.log('═'.repeat(70));

  try {
    // Patrones del sistema antiguo (sin ceros en el último segmento)
    // Ejemplo: 1.1.1, 1.1.2, 2.1.1, etc. (sin subcuentas)
    const oldSystemPatterns = [
      /^1\.1\.\d{1}$/,      // 1.1.1, 1.1.2, etc.
      /^1\.2\.\d{1}$/,      // 1.2.1, 1.2.2, etc.
      /^2\.1\.\d{1}$/,      // 2.1.1, 2.1.2, etc.
      /^2\.2\.\d{1}$/,      // 2.2.1, 2.2.2, etc.
      /^2\.3\.\d{1}$/,      // 2.3.1, etc.
      /^3\.1\.\d{1}$/,      // 3.1.1, etc.
      /^3\.2\.\d{1}$/,      // 3.2.1, etc.
      /^4\.1\.\d{1}$/,      // 4.1.1, etc.
      /^5\.1\.\d{1}$/,      // 5.1.1, etc.
      /^5\.2\.\d{1}$/,      // 5.2.1, etc.
      // Subcuentas del sistema antiguo
      /^1\.1\.\d{1}\.\d{3}$/,   // 1.1.1.001, etc.
      /^1\.2\.\d{1}\.\d{3}$/,   // 1.2.1.001, etc.
      /^2\.1\.\d{1}\.\d{3}$/,   // 2.1.1.001, etc.
      /^2\.2\.\d{1}\.\d{3}$/,   // 2.2.1.001, etc.
    ];

    // Obtener todas las cuentas
    const allAccounts = await prisma.chartOfAccount.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        isDetailAccount: true,
      },
      orderBy: { code: 'asc' },
    });

    // Filtrar cuentas del sistema antiguo
    const oldSystemAccounts = allAccounts.filter((acc) =>
      oldSystemPatterns.some((pattern) => pattern.test(acc.code))
    );

    console.log(`Total de cuentas: ${allAccounts.length}`);
    console.log(`Cuentas del sistema antiguo encontradas: ${oldSystemAccounts.length}\n`);

    if (oldSystemAccounts.length === 0) {
      console.log('✅ No hay cuentas del sistema antiguo para eliminar');
      return;
    }

    // Función para convertir código antiguo a nuevo
    const convertToNewCode = (oldCode: string): string => {
      const parts = oldCode.split('.');

      // Si tiene 3 partes (ej: 1.1.1), convertir a 1.1.01
      if (parts.length === 3 && parts[2].length === 1) {
        return `${parts[0]}.${parts[1]}.${parts[2].padStart(2, '0')}`;
      }

      // Si tiene 4 partes (ej: 1.1.1.001), convertir a 1.1.01.001
      if (parts.length === 4 && parts[2].length === 1) {
        return `${parts[0]}.${parts[1]}.${parts[2].padStart(2, '0')}.${parts[3]}`;
      }

      return oldCode; // No convertir si no coincide
    };

    let deleted = 0;
    let transferred = 0;
    let errors = 0;

    console.log('Procesando cuentas...\n');

    for (const oldAccount of oldSystemAccounts) {
      console.log(`\n📍 ${oldAccount.code} - ${oldAccount.name}`);

      try {
        // Buscar cuenta equivalente en sistema nuevo
        const newCode = convertToNewCode(oldAccount.code);
        const newAccount = await prisma.chartOfAccount.findUnique({
          where: { code: newCode },
          select: { id: true, code: true, name: true },
        });

        // Verificar relaciones
        const [hasJournalLines, hasTemplateLines, hasChildren] = await Promise.all([
          prisma.journalEntryLine.count({ where: { accountId: oldAccount.id } }),
          prisma.journalEntryTemplateLine.count({ where: { accountId: oldAccount.id } }),
          prisma.chartOfAccount.count({ where: { parentId: oldAccount.id } }),
        ]);

        // Si tiene hijos, primero eliminar los hijos (recursivamente)
        if (hasChildren > 0) {
          console.log(`   ⚠️  Tiene ${hasChildren} subcuentas - eliminando primero...`);
          await prisma.chartOfAccount.deleteMany({
            where: { parentId: oldAccount.id },
          });
          console.log(`   ✓ Subcuentas eliminadas`);
        }

        // Si tiene asientos o está en plantillas, transferir a la cuenta nueva
        if ((hasJournalLines > 0 || hasTemplateLines > 0) && newAccount) {
          console.log(`   🔄 Transferir datos a ${newCode}`);

          if (hasJournalLines > 0) {
            await prisma.journalEntryLine.updateMany({
              where: { accountId: oldAccount.id },
              data: { accountId: newAccount.id },
            });
            console.log(`   ✓ ${hasJournalLines} asientos transferidos`);
            transferred += hasJournalLines;
          }

          if (hasTemplateLines > 0) {
            await prisma.journalEntryTemplateLine.updateMany({
              where: { accountId: oldAccount.id },
              data: { accountId: newAccount.id },
            });
            console.log(`   ✓ ${hasTemplateLines} líneas de plantilla transferidas`);
          }
        } else if ((hasJournalLines > 0 || hasTemplateLines > 0) && !newAccount) {
          console.log(
            `   ❌ No se puede eliminar: tiene datos pero no existe cuenta equivalente (${newCode})`
          );
          errors++;
          continue;
        }

        // Eliminar cuenta antigua
        await prisma.chartOfAccount.delete({
          where: { id: oldAccount.id },
        });
        console.log(`   ✓ Cuenta eliminada`);
        deleted++;
      } catch (error) {
        console.log(
          `   ❌ Error: ${error instanceof Error ? error.message : 'Error desconocido'}`
        );
        errors++;
      }
    }

    // Resumen
    console.log('\n' + '═'.repeat(70));
    console.log('RESUMEN');
    console.log('═'.repeat(70));
    console.log(`✅ Cuentas eliminadas: ${deleted}`);
    console.log(`🔄 Asientos transferidos: ${transferred}`);
    console.log(`❌ Errores: ${errors}`);

    // Verificar resultado final
    const finalCount = await prisma.chartOfAccount.count();
    console.log(`\n📊 Total de cuentas final: ${finalCount}`);
    console.log(`📉 Reducción: ${allAccounts.length - finalCount} cuentas`);

    console.log('\n✅ Limpieza completada');
  } catch (error) {
    console.error('\n❌ ERROR:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
deleteOldNumberingSystem()
  .then(() => {
    console.log('\n🎉 Script completado exitosamente\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script falló:', error);
    process.exit(1);
  });

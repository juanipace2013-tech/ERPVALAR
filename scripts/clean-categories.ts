/**
 * Script: clean-categories.ts
 * Elimina categorías basura, mantiene solo las 14 correctas
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const VALID_CATEGORIES = [
  'ACCESORIOS-GE',
  'ACCESORIOS-WINTERS',
  'ACTUADOR',
  'CUCHILLA',
  'ELECTROVALVULAS',
  'LATON',
  'MANOMETRO',
  'MANOMETROS',
  'PRESOSTATO',
  'PVC',
  'REPUESTOS',
  'RIEGO',
  'SANITARIA',
  'VALVULA',
];

async function main() {
  console.log('🗑️  Limpiando categorías basura...\n');

  // Obtener todas las categorías
  const allCategories = await prisma.category.findMany();
  console.log(`Total categorías: ${allCategories.length}`);

  // Encontrar categorías basura (no están en la lista válida)
  const invalidCategories = allCategories.filter(
    (cat) => !VALID_CATEGORIES.includes(cat.name)
  );

  console.log(`Categorías válidas: ${allCategories.length - invalidCategories.length}`);
  console.log(`Categorías basura: ${invalidCategories.length}\n`);

  if (invalidCategories.length === 0) {
    console.log('✅ No hay categorías basura para eliminar\n');
    await prisma.$disconnect();
    return;
  }

  // Mostrar las primeras 20 categorías basura
  console.log('Primeras 20 categorías a eliminar:');
  invalidCategories.slice(0, 20).forEach((cat) => {
    console.log(`  - ${cat.name}`);
  });

  console.log('\n🔄 Eliminando categorías basura...');

  // Primero, actualizar productos que usan estas categorías a null
  for (const cat of invalidCategories) {
    await prisma.product.updateMany({
      where: { categoryId: cat.id },
      data: { categoryId: null },
    });
  }

  // Luego eliminar las categorías
  const deleted = await prisma.category.deleteMany({
    where: {
      id: {
        in: invalidCategories.map((cat) => cat.id),
      },
    },
  });

  console.log(`\n✅ ${deleted.count} categorías basura eliminadas\n`);

  // Verificar estado final
  const finalCount = await prisma.category.count();
  console.log(`Categorías restantes: ${finalCount}\n`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

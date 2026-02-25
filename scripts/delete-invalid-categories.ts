/**
 * Script: delete-invalid-categories.ts
 * Elimina directamente las categorías basura que quedan
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
  console.log('🗑️  Eliminando categorías inválidas...\n');

  // Obtener todas las categorías
  const allCategories = await prisma.category.findMany();

  // Encontrar las inválidas
  const invalidCategories = allCategories.filter(
    (cat) => !VALID_CATEGORIES.includes(cat.name)
  );

  console.log(`Categorías a eliminar: ${invalidCategories.length}`);
  invalidCategories.forEach((cat) => console.log(`  - ${cat.name}`));
  console.log('');

  if (invalidCategories.length === 0) {
    console.log('✅ No hay categorías inválidas\n');
    await prisma.$disconnect();
    return;
  }

  // Desvincular productos de estas categorías
  console.log('Desvinculando productos...');
  await prisma.product.updateMany({
    where: {
      categoryId: {
        in: invalidCategories.map((cat) => cat.id),
      },
    },
    data: {
      categoryId: null,
    },
  });

  // Eliminar las categorías
  console.log('Eliminando categorías...');
  const deleted = await prisma.category.deleteMany({
    where: {
      id: {
        in: invalidCategories.map((cat) => cat.id),
      },
    },
  });

  console.log(`\n✅ ${deleted.count} categorías eliminadas`);

  // Verificar resultado
  const remaining = await prisma.category.count();
  console.log(`Categorías restantes: ${remaining}\n`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

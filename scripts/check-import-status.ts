/**
 * Script: check-import-status.ts
 * Verifica el estado de la importación
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.count();
  const categories = await prisma.category.count();
  const discounts = await prisma.brandDiscount.count();

  console.log('Estado de la importación:');
  console.log('='.repeat(60));
  console.log(`📦 Productos: ${products}`);
  console.log(`📂 Categorías: ${categories}`);
  console.log(`💰 Descuentos: ${discounts}`);
  console.log('='.repeat(60));

  await prisma.$disconnect();
}

main();

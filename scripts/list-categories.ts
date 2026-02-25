/**
 * Script: list-categories.ts
 * Lista todas las categorías actuales
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const categories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
  });

  console.log(`Total categorías: ${categories.length}\n`);
  categories.forEach((cat, idx) => {
    console.log(`${idx + 1}. ${cat.name}`);
  });

  await prisma.$disconnect();
}

main();

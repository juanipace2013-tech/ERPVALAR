/**
 * Script: clean-import.ts
 * Limpia productos y categorías creados incorrectamente
 *
 * Uso: npx tsx scripts/clean-import.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🗑️  Limpiando datos incorrectos...\n');

  try {
    // 1. Eliminar relaciones primero (items de cotizaciones, facturas, etc.)
    console.log('Eliminando items relacionados...');
    await prisma.quoteItem.deleteMany({});
    await prisma.quoteItemAdditional.deleteMany({});
    await prisma.deliveryNoteItem.deleteMany({});
    await prisma.invoiceItem.deleteMany({});
    await prisma.purchaseOrderItem.deleteMany({});
    await prisma.purchaseInvoiceItem.deleteMany({});
    await prisma.stockMovement.deleteMany({});
    await prisma.warehouseStock.deleteMany({});
    await prisma.priceListItem.deleteMany({});
    await prisma.productPrice.deleteMany({});
    console.log('✅ Items relacionados eliminados');

    // 2. Eliminar productos importados
    const deletedProducts = await prisma.product.deleteMany({});
    console.log(`✅ ${deletedProducts.count} productos eliminados`);

    // 3. Eliminar categorías
    const deletedCategories = await prisma.category.deleteMany({});
    console.log(`✅ ${deletedCategories.count} categorías eliminadas`);

    // 4. Eliminar descuentos
    const deletedDiscounts = await prisma.brandDiscount.deleteMany({});
    console.log(`✅ ${deletedDiscounts.count} descuentos eliminados`);

    console.log('\n✅ Limpieza completada\n');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

/**
 * Script: import-products-fast.ts
 * Importa productos usando operaciones batch (MUCHO MÁS RÁPIDO)
 */

import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';
import * as path from 'path';

const prisma = new PrismaClient();

interface ProductRow {
  sku: string;
  brand: string;
  type: string;
  description: string;
  listPriceUSD: number;
}

interface DiscountRow {
  type: string;
  brand: string;
  discountPercent: number;
}

async function main() {
  console.log('🚀 Iniciando importación RÁPIDA de productos...\n');

  const excelPath = path.join(process.cwd(), 'data', 'Prototipo_Oferta.xltx');
  console.log(`📁 Leyendo archivo: ${excelPath}`);

  const workbook = XLSX.readFile(excelPath);
  const worksheet = workbook.Sheets['Precio Lista'];
  const data: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  console.log(`✅ Hoja cargada\n`);

  // 1. Procesar PRODUCTOS
  const products: ProductRow[] = [];
  const uniqueTypes = new Set<string>();

  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    const sku = (row[0] || '').toString().trim();
    const brand = (row[1] || '').toString().trim();
    const type = (row[2] || '').toString().trim();
    const description = (row[3] || '').toString().trim();
    const priceStr = row[4];

    if (!sku || !description) continue;

    let listPriceUSD = 0;
    if (priceStr !== undefined && priceStr !== null && priceStr !== '') {
      listPriceUSD = parseFloat(priceStr.toString());
      if (isNaN(listPriceUSD)) listPriceUSD = 0;
    }

    products.push({
      sku,
      brand: brand || 'SIN MARCA ASIGNADA',
      type: type || 'OTROS',
      description,
      listPriceUSD,
    });

    uniqueTypes.add(type || 'OTROS');
  }

  console.log(`✅ ${products.length} productos procesados`);
  console.log(`✅ ${uniqueTypes.size} tipos únicos\n`);

  // 2. Procesar DESCUENTOS
  const discounts: DiscountRow[] = [];
  for (let i = 2; i < Math.min(data.length, 50); i++) {
    const row = data[i];
    const discountType = (row[6] || '').toString().trim();
    const discountBrand = (row[7] || '').toString().trim();
    const discountValue = row[8];

    if (!discountType || !discountBrand || discountBrand === 'Marca') continue;

    let discountPercent = 0;
    if (discountValue !== undefined && discountValue !== null && discountValue !== '') {
      discountPercent = parseFloat(discountValue.toString()) * 100;
      if (isNaN(discountPercent)) discountPercent = 0;
    }

    discounts.push({ type: discountType, brand: discountBrand, discountPercent });
  }

  console.log(`✅ ${discounts.length} descuentos procesados\n`);

  // 3. Crear CATEGORÍAS
  console.log('📂 Creando categorías...');
  const categoryMap = new Map<string, string>();

  for (const type of uniqueTypes) {
    const category = await prisma.category.upsert({
      where: { name: type },
      update: {},
      create: { name: type, description: `Categoría: ${type}` },
    });
    categoryMap.set(type, category.id);
  }

  console.log(`✅ ${categoryMap.size} categorías creadas\n`);

  // 4. Importar DESCUENTOS
  console.log('💰 Importando descuentos...');
  for (const discount of discounts) {
    await prisma.brandDiscount.upsert({
      where: {
        brand_productType: { brand: discount.brand, productType: discount.type },
      },
      update: { discountPercent: discount.discountPercent },
      create: {
        brand: discount.brand,
        productType: discount.type,
        discountPercent: discount.discountPercent,
      },
    });
  }
  console.log(`✅ ${discounts.length} descuentos importados\n`);

  // 5. Importar PRODUCTOS EN BATCH (500 por lote)
  console.log('📦 Importando productos en batches de 500...');
  const BATCH_SIZE = 500;
  let created = 0;

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);

    const productsToCreate = batch.map(p => ({
      sku: p.sku,
      name: p.description,
      brand: p.brand,
      categoryId: categoryMap.get(p.type) || null,
      listPriceUSD: p.listPriceUSD,
      type: 'PRODUCT' as const,
      status: 'ACTIVE' as const,
      isTaxable: true,
      taxRate: 21,
      trackInventory: true,
      unit: 'UN',
      stockQuantity: 0,
      minStock: 0,
    }));

    // Skip duplicates
    await prisma.product.createMany({
      data: productsToCreate,
      skipDuplicates: true,
    });

    created += batch.length;
    console.log(`   Importados... ${created}/${products.length}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ IMPORTACIÓN COMPLETADA');
  console.log('='.repeat(60));
  console.log(`📦 Productos importados: ~${created}`);
  console.log(`📂 Categorías: ${categoryMap.size}`);
  console.log(`💰 Descuentos: ${discounts.length}`);
  console.log('='.repeat(60) + '\n');

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});

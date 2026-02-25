/**
 * Script: import-products.ts
 * Importa productos desde Excel "Prototipo_Oferta.xltx" hoja "Precio Lista"
 * Importa también descuentos por tipo+marca
 *
 * ESTRUCTURA REAL DEL EXCEL:
 * - Fila 1: Vacía
 * - Fila 2: Headers
 * - Fila 3+: Datos
 *
 * PRODUCTOS: A=SKU(0), B=Marca(1), C=Tipo(2), D=Description(3), E=Precio(4)
 * DESCUENTOS: G=Tipo(6), H=Marca(7), I=Descuento(8)
 *
 * Uso: npx tsx scripts/import-products.ts
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
  console.log('🚀 Iniciando importación de productos...\n');

  // 1. Leer archivo Excel
  const excelPath = path.join(process.cwd(), 'data', 'Prototipo_Oferta.xltx');
  console.log(`📁 Leyendo archivo: ${excelPath}`);

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.readFile(excelPath);
  } catch (error) {
    console.error(`❌ Error al leer el archivo Excel: ${error}`);
    console.log('\n⚠️  INSTRUCCIÓN: Por favor, copie el archivo Prototipo_Oferta.xltx a la carpeta data/');
    process.exit(1);
  }

  // 2. Leer hoja "Precio Lista"
  const sheetName = 'Precio Lista';
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    console.error(`❌ No se encontró la hoja "${sheetName}" en el Excel`);
    console.log('Hojas disponibles:', workbook.SheetNames);
    process.exit(1);
  }

  console.log(`✅ Hoja "${sheetName}" encontrada\n`);

  // 3. Convertir a JSON
  const data: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  console.log(`📊 Total de filas: ${data.length}`);
  console.log(`   Fila 1: ${data[0] ? 'Vacía' : 'No existe'}`);
  console.log(`   Fila 2: Headers`);
  console.log(`   Fila 3+: Datos (${data.length - 2} filas de datos)\n`);

  // 4. Procesar PRODUCTOS (desde fila 3, índice 2)
  // Columnas: A=0 (SKU), B=1 (Marca), C=2 (Tipo), D=3 (Description), E=4 (Precio)
  const products: ProductRow[] = [];
  const uniqueTypes = new Set<string>();

  console.log('🔄 Procesando PRODUCTOS...\n');

  for (let i = 2; i < data.length; i++) {
    const row = data[i];

    const sku = (row[0] || '').toString().trim();
    const brand = (row[1] || '').toString().trim();
    const type = (row[2] || '').toString().trim();
    const description = (row[3] || '').toString().trim();
    const priceStr = row[4];

    // Validar que tenga al menos SKU y descripción
    if (!sku || !description) {
      continue;
    }

    // Parsear precio
    let listPriceUSD = 0;
    if (priceStr !== undefined && priceStr !== null && priceStr !== '') {
      listPriceUSD = parseFloat(priceStr.toString());
      if (isNaN(listPriceUSD)) {
        listPriceUSD = 0;
      }
    }

    products.push({
      sku,
      brand: brand || 'SIN MARCA ASIGNADA',
      type: type || 'OTROS',
      description,
      listPriceUSD,
    });

    // Extraer tipos únicos de columna C (índice 2)
    if (type) {
      uniqueTypes.add(type);
    } else {
      uniqueTypes.add('OTROS');
    }
  }

  console.log(`✅ Productos a importar: ${products.length}`);
  console.log(`✅ Tipos únicos (columna C): ${uniqueTypes.size}`);
  console.log('   Tipos encontrados:');
  Array.from(uniqueTypes).sort().forEach(t => console.log(`     - ${t}`));
  console.log('');

  // 5. Procesar DESCUENTOS (desde fila 3, índice 2)
  // Columnas: G=6 (Tipo), H=7 (Marca), I=8 (Descuento)
  const discounts: DiscountRow[] = [];

  console.log('💰 Procesando DESCUENTOS (columnas G, H, I)...\n');

  for (let i = 2; i < Math.min(data.length, 50); i++) {
    const row = data[i];

    const discountType = (row[6] || '').toString().trim();
    const discountBrand = (row[7] || '').toString().trim();
    const discountValue = row[8];

    // Si la columna G está vacía, no hay más descuentos
    if (!discountType) {
      continue;
    }

    // Si la columna H está vacía o es "Marca" (header), saltar
    if (!discountBrand || discountBrand === 'Marca') {
      continue;
    }

    // Validar que tenga valor de descuento
    if (discountValue !== undefined && discountValue !== null && discountValue !== '') {
      const discountPercent = parseFloat(discountValue.toString()) * 100; // 0.35 → 35%

      if (!isNaN(discountPercent) && discountPercent > 0) {
        discounts.push({
          type: discountType,
          brand: discountBrand,
          discountPercent,
        });
        console.log(`   ${discountType.padEnd(20)} + ${discountBrand.padEnd(20)} = ${discountPercent.toFixed(0)}%`);
      }
    } else {
      // Descuento 0% (cuando columna I está vacía)
      discounts.push({
        type: discountType,
        brand: discountBrand,
        discountPercent: 0,
      });
      console.log(`   ${discountType.padEnd(20)} + ${discountBrand.padEnd(20)} = 0%`);
    }
  }

  console.log(`\n✅ Descuentos encontrados: ${discounts.length}\n`);

  // 6. Crear categorías (solo valores únicos de columna C)
  console.log('📂 Creando categorías...');
  const categoryMap = new Map<string, string>(); // tipo -> categoryId

  for (const type of uniqueTypes) {
    const category = await prisma.category.upsert({
      where: { name: type },
      update: {},
      create: {
        name: type,
        description: `Categoría: ${type}`,
      },
    });
    categoryMap.set(type, category.id);
  }

  console.log(`✅ ${categoryMap.size} categorías creadas/actualizadas\n`);

  // 7. Importar descuentos
  console.log('💰 Importando descuentos por tipo+marca...');
  let discountsCreated = 0;
  let discountsUpdated = 0;

  for (const discount of discounts) {
    try {
      const existing = await prisma.brandDiscount.findUnique({
        where: {
          brand_productType: {
            brand: discount.brand,
            productType: discount.type,
          },
        },
      });

      if (existing) {
        await prisma.brandDiscount.update({
          where: { id: existing.id },
          data: { discountPercent: discount.discountPercent },
        });
        discountsUpdated++;
      } else {
        await prisma.brandDiscount.create({
          data: {
            brand: discount.brand,
            productType: discount.type,
            discountPercent: discount.discountPercent,
          },
        });
        discountsCreated++;
      }
    } catch (error) {
      console.error(`❌ Error con descuento ${discount.type}+${discount.brand}:`, error);
    }
  }

  console.log(`✅ ${discountsCreated} descuentos creados`);
  console.log(`✅ ${discountsUpdated} descuentos actualizados\n`);

  // 8. Importar productos
  console.log('📦 Importando productos...');
  let created = 0;
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];

    // Mostrar progreso cada 1000 productos
    if ((i + 1) % 1000 === 0) {
      console.log(`   Procesando... ${i + 1}/${products.length}`);
    }

    try {
      const categoryId = categoryMap.get(product.type) || null;

      const existing = await prisma.product.findUnique({
        where: { sku: product.sku },
      });

      if (existing) {
        // Actualizar producto existente
        await prisma.product.update({
          where: { sku: product.sku },
          data: {
            name: product.description,
            brand: product.brand,
            categoryId,
            listPriceUSD: product.listPriceUSD,
            status: 'ACTIVE',
            isTaxable: true,
            taxRate: 21,
            trackInventory: true,
            unit: 'UN',
          },
        });
        updated++;
      } else {
        // Crear nuevo producto
        await prisma.product.create({
          data: {
            sku: product.sku,
            name: product.description,
            brand: product.brand,
            categoryId,
            listPriceUSD: product.listPriceUSD,
            type: 'PRODUCT',
            status: 'ACTIVE',
            isTaxable: true,
            taxRate: 21,
            trackInventory: true,
            unit: 'UN',
            stockQuantity: 0,
            minStock: 0,
          },
        });
        created++;
      }
    } catch (error: any) {
      console.error(`❌ Error con producto ${product.sku}:`, error.message);
      errors++;
    }
  }

  // 9. Resumen
  console.log('\n' + '='.repeat(60));
  console.log('✅ IMPORTACIÓN COMPLETADA');
  console.log('='.repeat(60));
  console.log(`📦 Productos creados: ${created}`);
  console.log(`🔄 Productos actualizados: ${updated}`);
  console.log(`❌ Errores: ${errors}`);
  console.log(`📂 Categorías: ${categoryMap.size}`);
  console.log(`💰 Descuentos: ${discountsCreated} creados, ${discountsUpdated} actualizados`);
  console.log('='.repeat(60) + '\n');

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});

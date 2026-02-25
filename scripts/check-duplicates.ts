/**
 * Script: check-duplicates.ts
 * Verifica si hay SKUs duplicados en el Excel
 */

import * as XLSX from 'xlsx';
import * as path from 'path';

const excelPath = path.join(process.cwd(), 'data', 'Prototipo_Oferta.xltx');
const workbook = XLSX.readFile(excelPath);
const worksheet = workbook.Sheets['Precio Lista'];
const data: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

const skuCount = new Map<string, number>();
const typeCount = new Map<string, number>();
let emptySkus = 0;
let emptyTypes = 0;

for (let i = 2; i < data.length; i++) {
  const row = data[i];
  const sku = (row[0] || '').toString().trim();
  const type = (row[2] || '').toString().trim();

  if (!sku) {
    emptySkus++;
    continue;
  }

  skuCount.set(sku, (skuCount.get(sku) || 0) + 1);

  if (type) {
    typeCount.set(type, (typeCount.get(type) || 0) + 1);
  } else {
    emptyTypes++;
  }
}

console.log('Análisis del Excel:');
console.log('='.repeat(60));
console.log(`Total filas: ${data.length - 2}`);
console.log(`SKUs únicos: ${skuCount.size}`);
console.log(`Tipos únicos: ${typeCount.size}`);
console.log(`Filas sin SKU: ${emptySkus}`);
console.log(`Filas sin tipo: ${emptyTypes}`);
console.log('');

const duplicates = Array.from(skuCount.entries()).filter(([_, count]) => count > 1);
if (duplicates.length > 0) {
  console.log(`⚠️  SKUs duplicados: ${duplicates.length}`);
  console.log('Primeros 20 duplicados:');
  duplicates.slice(0, 20).forEach(([sku, count]) => {
    console.log(`  ${sku}: ${count} veces`);
  });
} else {
  console.log('✅ No hay SKUs duplicados');
}

console.log('');
console.log('Tipos encontrados:');
Array.from(typeCount.keys()).sort().forEach(type => {
  console.log(`  - ${type} (${typeCount.get(type)} productos)`);
});

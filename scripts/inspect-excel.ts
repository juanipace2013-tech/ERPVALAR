/**
 * Script: inspect-excel.ts
 * Inspecciona el archivo Excel para ver la estructura real
 */

import * as XLSX from 'xlsx';
import * as path from 'path';

const excelPath = path.join(process.cwd(), 'data', 'Prototipo_Oferta.xltx');
const workbook = XLSX.readFile(excelPath);
const worksheet = workbook.Sheets['Precio Lista'];
const data: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

console.log('FILA 1 (HEADERS):');
console.log('='.repeat(80));
const headers = data[0];
for (let i = 0; i < Math.min(headers.length, 15); i++) {
  const letter = String.fromCharCode(65 + i); // A, B, C, D, ...
  console.log(`Columna ${letter} (índice ${i}): "${headers[i]}"`);
}

console.log('\n\nFILA 2 (PRIMER PRODUCTO):');
console.log('='.repeat(80));
const row2 = data[1];
for (let i = 0; i < Math.min(row2.length, 15); i++) {
  const letter = String.fromCharCode(65 + i);
  const value = (row2[i] || '').toString();
  console.log(`Columna ${letter} (índice ${i}): "${value.substring(0, 60)}"`);
}

console.log('\n\nFILA 3 (SEGUNDO PRODUCTO):');
console.log('='.repeat(80));
const row3 = data[2];
for (let i = 0; i < Math.min(row3.length, 15); i++) {
  const letter = String.fromCharCode(65 + i);
  const value = (row3[i] || '').toString();
  console.log(`Columna ${letter} (índice ${i}): "${value.substring(0, 60)}"`);
}

console.log('\n\nTABLA DE DESCUENTOS (COLUMNAS H, I, J):');
console.log('='.repeat(80));
for (let i = 1; i <= 30; i++) {
  const row = data[i];
  if (!row) break;

  const h = (row[7] || '').toString().trim();
  const iCol = (row[8] || '').toString().trim();
  const j = (row[9] || '').toString();

  if (!h) break;

  console.log(`Fila ${i+1}: H="${h}" | I="${iCol}" | J="${j}"`);
}

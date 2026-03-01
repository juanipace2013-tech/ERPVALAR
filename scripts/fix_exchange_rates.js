/**
 * Script: fix_exchange_rates.js
 *
 * Corrige las facturas que tienen exchangeRate = null.
 * Se conecta a Colppy para obtener el tipo de cambio (rate) de cada factura
 * y actualiza el campo exchangeRate en la base de datos local.
 *
 * Uso: node scripts/fix_exchange_rates.js
 *
 * Requiere: DATABASE_URL en .env y credenciales Colppy (COLPPY_USER, COLPPY_PASSWORD, COLPPY_ID_EMPRESA)
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Cargar .env manualmente (no necesita dotenv)
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.substring(0, eqIdx);
  let val = trimmed.substring(eqIdx + 1);
  // Quitar comillas
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  env[key] = val;
}

const DATABASE_URL = env.DATABASE_URL || process.env.DATABASE_URL;
const COLPPY_ENDPOINT = 'https://login.colppy.com/lib/frontera2/service.php';
const COLPPY_USER = env.COLPPY_USER || process.env.COLPPY_USER || '';
const COLPPY_PASSWORD = env.COLPPY_PASSWORD || process.env.COLPPY_PASSWORD || '';
const COLPPY_ID_EMPRESA = env.COLPPY_ID_EMPRESA || process.env.COLPPY_ID_EMPRESA || '';

function md5(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

function callColppy(payload) {
  let tempFile = null;
  try {
    tempFile = path.join(os.tmpdir(), `colppy-fix-${Date.now()}.json`);
    fs.writeFileSync(tempFile, JSON.stringify(payload), 'utf-8');
    const cmd = `curl -s -X POST "${COLPPY_ENDPOINT}" -H "Content-Type: application/json" -d @"${tempFile}" --max-time 120 -L`;
    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 130000,
      maxBuffer: 50 * 1024 * 1024,
    });
    const trimmed = result.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      throw new Error(`Respuesta no-JSON (${trimmed.length} bytes): ${trimmed.substring(0, 200)}`);
    }
    return JSON.parse(trimmed);
  } finally {
    if (tempFile && fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
    }
  }
}

function colppyLogin() {
  const passwordMD5 = md5(COLPPY_PASSWORD);
  const response = callColppy({
    auth: { usuario: COLPPY_USER, password: passwordMD5 },
    service: { provision: 'Usuario', operacion: 'iniciar_sesion' },
    parameters: { usuario: COLPPY_USER, password: passwordMD5 },
  });
  if (response.result?.estado !== 0) {
    throw new Error(`Error login Colppy: ${response.result?.mensaje}`);
  }
  console.log('✓ Login Colppy OK');
  return response.response.data.claveSesion;
}

function fetchAllFacturas(claveSesion, passwordMD5, dateFrom, dateTo) {
  const PAGE_SIZE = 500;
  const allFacturas = [];
  let start = 0;
  let hasMore = true;

  while (hasMore) {
    const payload = {
      auth: { usuario: COLPPY_USER, password: passwordMD5 },
      service: { provision: 'FacturaVenta', operacion: 'listar_facturasventa' },
      parameters: {
        sesion: { usuario: COLPPY_USER, claveSesion },
        idEmpresa: COLPPY_ID_EMPRESA,
        start,
        limit: PAGE_SIZE,
        filter: [
          { field: 'fechaFactura', op: '>=', value: dateFrom },
          { field: 'fechaFactura', op: '<=', value: dateTo },
        ],
        order: { field: ['idFactura'], order: 'desc' },
      },
    };

    const response = callColppy(payload);
    if (response.result?.estado !== 0 || !response.response?.success) {
      throw new Error(response.result?.mensaje || 'Error al obtener facturas');
    }

    const pageData = response.response.data || [];
    allFacturas.push(...pageData);
    console.log(`  Página ${Math.floor(start / PAGE_SIZE) + 1}: ${pageData.length} facturas (acumulado: ${allFacturas.length})`);

    if (pageData.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      start += PAGE_SIZE;
      // Delay entre páginas
      try { execSync('timeout /t 1 >nul 2>&1 || sleep 1', { timeout: 3000 }); } catch { /* ignore */ }
    }
  }

  return allFacturas;
}

// Ejecutar SQL directo contra PostgreSQL usando la DATABASE_URL
function execSQL(sql) {
  const tempFile = path.join(os.tmpdir(), `sql-fix-${Date.now()}.sql`);
  try {
    fs.writeFileSync(tempFile, sql, 'utf-8');
    // Usar npx prisma db execute
    const result = execSync(
      `npx prisma db execute --datasource-url "${DATABASE_URL}" --file "${tempFile}"`,
      {
        encoding: 'utf-8',
        timeout: 30000,
        cwd: path.join(__dirname, '..'),
      }
    );
    return result;
  } finally {
    if (fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
    }
  }
}

async function main() {
  console.log('=== Fix Exchange Rates - Backfill Script ===\n');

  if (!COLPPY_USER || !COLPPY_PASSWORD || !COLPPY_ID_EMPRESA) {
    console.error('ERROR: Faltan credenciales de Colppy en .env');
    process.exit(1);
  }
  if (!DATABASE_URL) {
    console.error('ERROR: Falta DATABASE_URL en .env');
    process.exit(1);
  }

  // 1. Login a Colppy
  console.log('1. Conectando a Colppy...');
  const claveSesion = colppyLogin();
  const passwordMD5 = md5(COLPPY_PASSWORD);

  // 2. Obtener TODAS las facturas desde 2026-01-01
  console.log('\n2. Obteniendo facturas desde Colppy...');
  const facturas = fetchAllFacturas(claveSesion, passwordMD5, '2026-01-01', '2026-12-31');
  console.log(`\n✓ Total facturas obtenidas de Colppy: ${facturas.length}`);

  // 3. Construir un mapa idFactura -> rate
  const rateMap = new Map();
  let withRate = 0;
  let withoutRate = 0;

  for (const f of facturas) {
    const idFactura = String(f.idFactura || '');
    const rate = parseFloat(String(f.rate || f.valorCambio || f.cotizacion || '0'));
    if (idFactura && rate > 0) {
      rateMap.set(idFactura, rate);
      withRate++;
    } else {
      withoutRate++;
    }
  }

  console.log(`\n3. Mapa de tipos de cambio:`);
  console.log(`   - Con rate válido: ${withRate}`);
  console.log(`   - Sin rate: ${withoutRate}`);

  if (rateMap.size === 0) {
    console.log('\nNo hay rates para actualizar. Saliendo.');
    return;
  }

  // 4. Generar UPDATE masivo
  console.log('\n4. Generando actualizaciones SQL...');

  // Construir un solo UPDATE con CASE WHEN
  const entries = Array.from(rateMap.entries());
  const batchSize = 100;
  let totalUpdated = 0;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);

    // Generar SQL con CASE para cada colppyId
    const colppyIds = batch.map(([id]) => `'${id}'`).join(', ');
    const caseStatements = batch
      .map(([id, rate]) => `WHEN "colppyId" = '${id}' THEN ${rate}`)
      .join('\n    ');

    const sql = `UPDATE "Invoice"
SET "exchangeRate" = CASE
    ${caseStatements}
    ELSE "exchangeRate"
END
WHERE "colppyId" IN (${colppyIds})
  AND ("exchangeRate" IS NULL OR "exchangeRate" = 0 OR "exchangeRate" = 1);`;

    try {
      execSQL(sql);
      totalUpdated += batch.length;
      console.log(`   Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} facturas procesadas`);
    } catch (err) {
      console.error(`   ERROR en batch ${Math.floor(i / batchSize) + 1}: ${err.message}`);
    }
  }

  console.log(`\n✓ Total procesado: ${totalUpdated} facturas`);

  // 5. Verificar resultado
  console.log('\n5. Verificando resultado...');
  try {
    const verifySql = `SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN "exchangeRate" IS NULL THEN 1 END) as sin_rate,
  COUNT(CASE WHEN "exchangeRate" IS NOT NULL AND "exchangeRate" > 0 THEN 1 END) as con_rate
FROM "Invoice"
WHERE "colppyId" IS NOT NULL;`;

    // Can't easily get SELECT results via prisma db execute, so just log the SQL
    console.log('   Para verificar, ejecutar en la DB:');
    console.log(`   ${verifySql.replace(/\n/g, '\n   ')}`);
  } catch {
    // ignore
  }

  console.log('\n=== Fix Exchange Rates COMPLETADO ===');
}

main().catch((err) => {
  console.error('\nERROR FATAL:', err.message);
  process.exit(1);
});

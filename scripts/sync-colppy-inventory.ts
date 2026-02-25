/**
 * Script: sync-colppy-inventory.ts
 * Sincroniza productos del CRM con el inventario de Colppy
 * Vincula productos por código (SKU) y actualiza stock
 *
 * Uso: npx tsx scripts/sync-colppy-inventory.ts
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const prisma = new PrismaClient();

// Configuración Colppy
const COLPPY_ENDPOINT = 'https://login.colppy.com/lib/frontera2/service.php';
const COLPPY_USER = process.env.COLPPY_USER || '';
const COLPPY_PASSWORD = process.env.COLPPY_PASSWORD || '';
const COLPPY_ID_EMPRESA = process.env.COLPPY_ID_EMPRESA || '';

function md5(text: string): string {
  return crypto.createHash('md5').update(text).digest('hex');
}

function callColppy(payload: any): any {
  let tempFile: string | null = null;

  try {
    // Crear archivo temporal para el payload
    tempFile = path.join(os.tmpdir(), `colppy-${Date.now()}.json`);
    const payloadStr = JSON.stringify(payload);
    fs.writeFileSync(tempFile, payloadStr, 'utf-8');

    // Ejecutar curl usando el archivo temporal
    const cmd = `curl -s -X POST "${COLPPY_ENDPOINT}" -H "Content-Type: application/json" -d @"${tempFile}" --max-time 120 -L`;

    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 125000,
      maxBuffer: 50 * 1024 * 1024, // 50MB para muchos items
    });

    return JSON.parse(result);
  } catch (error: any) {
    throw new Error(`Error llamando a Colppy: ${error.message}`);
  } finally {
    // Limpiar archivo temporal
    if (tempFile && fs.existsSync(tempFile)) {
      try {
        fs.unlinkSync(tempFile);
      } catch {
        // Ignorar error al limpiar
      }
    }
  }
}

function getSession(): string {
  console.log('🔐 Iniciando sesión en Colppy...');
  const passwordMD5 = md5(COLPPY_PASSWORD);

  const response = callColppy({
    auth: { usuario: COLPPY_USER, password: passwordMD5 },
    service: { provision: 'Usuario', operacion: 'iniciar_sesion' },
    parameters: { usuario: COLPPY_USER, password: passwordMD5 },
  });

  if (response.result?.estado !== 0) {
    throw new Error(`Error login Colppy: ${response.result?.mensaje}`);
  }

  console.log('✅ Sesión iniciada\n');
  return response.response.data.claveSesion;
}

function getInventoryItems(session: string): any[] {
  console.log('📦 Obteniendo items de inventario de Colppy...');
  const passwordMD5 = md5(COLPPY_PASSWORD);

  const response = callColppy({
    auth: { usuario: COLPPY_USER, password: passwordMD5 },
    service: { provision: 'Inventario', operacion: 'listar_itemsinventario' },
    parameters: {
      sesion: { usuario: COLPPY_USER, claveSesion: session },
      idEmpresa: COLPPY_ID_EMPRESA,
      start: 0,
      limit: 3000,
      filter: [],
      order: [{ field: 'idItem', order: 'asc' }],
    },
  });

  if (response.result?.estado !== 0 || !response.response?.success) {
    throw new Error(
      response.result?.mensaje || response.response?.message || 'Error obteniendo inventario'
    );
  }

  const items = response.response.data || [];
  console.log(`✅ ${items.length} items obtenidos de Colppy\n`);
  return items;
}

async function main() {
  console.log('🚀 Iniciando sincronización con inventario Colppy...\n');
  console.log('='.repeat(60));

  try {
    // 1. Conectar con Colppy
    const session = getSession();

    // 2. Obtener items de inventario
    const colppyItems = getInventoryItems(session);

    if (colppyItems.length === 0) {
      console.log('⚠️  No se encontraron items en Colppy');
      return;
    }

    // 3. Procesar cada item de Colppy
    console.log('🔄 Vinculando productos con inventario Colppy...\n');
    let vinculados = 0;
    let sinCoincidencia = 0;
    let actualizados = 0;
    let errores = 0;

    for (let i = 0; i < colppyItems.length; i++) {
      const item = colppyItems[i];

      // Mostrar progreso cada 500 items
      if ((i + 1) % 500 === 0) {
        console.log(`   Procesando... ${i + 1}/${colppyItems.length}`);
      }

      try {
        const codigo = (item.codigo || '').toString().trim();
        const descripcion = (item.descripcion || '').toString();
        const idItem = parseInt(item.idItem);
        const disponibilidad = parseInt(item.disponibilidad || 0);

        if (!codigo) {
          continue; // Item sin código
        }

        // Buscar producto en CRM por SKU
        const product = await prisma.product.findUnique({
          where: { sku: codigo },
        });

        if (product) {
          // Actualizar vinculación
          await prisma.product.update({
            where: { id: product.id },
            data: {
              colppyItemId: idItem,
              colppyCode: codigo,
              stockQuantity: disponibilidad,
            },
          });
          vinculados++;
          actualizados++;
        } else {
          sinCoincidencia++;
          if (sinCoincidencia <= 10) {
            // Mostrar solo los primeros 10 sin coincidencia
            console.log(`   ⚠️  Sin coincidencia: ${codigo} - ${descripcion.substring(0, 50)}...`);
          }
        }
      } catch (error: any) {
        errores++;
        console.error(`   ❌ Error procesando item ${item.codigo}:`, error.message);
      }
    }

    // 4. Verificar productos del CRM sin vincular
    console.log('\n📊 Verificando productos del CRM...');
    const totalProducts = await prisma.product.count();
    const linkedProducts = await prisma.product.count({
      where: {
        colppyItemId: { not: null },
      },
    });
    const unlinkedProducts = totalProducts - linkedProducts;

    // 5. Resumen
    console.log('\n' + '='.repeat(60));
    console.log('✅ SINCRONIZACIÓN COMPLETADA');
    console.log('='.repeat(60));
    console.log(`📦 Items en Colppy: ${colppyItems.length}`);
    console.log(`🔗 Productos vinculados: ${vinculados}`);
    console.log(`🔄 Productos actualizados: ${actualizados}`);
    console.log(`⚠️  Items de Colppy sin coincidencia en CRM: ${sinCoincidencia}`);
    console.log(`❌ Errores: ${errores}`);
    console.log('');
    console.log(`📋 Total productos en CRM: ${totalProducts}`);
    console.log(`✅ Con vinculación Colppy: ${linkedProducts} (${((linkedProducts / totalProducts) * 100).toFixed(1)}%)`);
    console.log(`⚠️  Sin vinculación Colppy: ${unlinkedProducts} (${((unlinkedProducts / totalProducts) * 100).toFixed(1)}%)`);
    console.log('='.repeat(60) + '\n');

    if (unlinkedProducts > 0) {
      console.log('💡 Los productos sin vinculación no están en Colppy.');
      console.log('   Se crearán automáticamente al facturarlos por primera vez.\n');
    }
  } catch (error: any) {
    console.error('❌ Error fatal:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});

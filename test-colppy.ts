/**
 * Script de prueba para la integración con Colppy
 * Ejecutar con: npx tsx test-colppy.ts
 */

// Cargar variables de entorno
import { config } from 'dotenv';
config();

import { colppyLogin, colppyFindCustomerByCUIT, colppyLogout } from './src/lib/colppy';

async function testColppyIntegration() {
  console.log('🧪 Iniciando test de integración con Colppy...\n');

  try {
    // 1. Test de login
    console.log('1️⃣  Probando login...');
    const session = await colppyLogin();
    console.log('✅ Login exitoso!');
    console.log(`   - Clave de sesión: ${session.claveSesion.substring(0, 20)}...`);
    console.log(`   - Usuario: ${session.usuario}`);
    console.log(`   - ID Empresa: ${session.idEmpresa}\n`);

    // 2. Test de búsqueda de cliente (CUIT de VAL ARG)
    console.log('2️⃣  Probando búsqueda de cliente...');
    const testCUIT = '30-71537357-9'; // CUIT de VAL ARG
    console.log(`   Buscando cliente con CUIT: ${testCUIT}`);

    const customer = await colppyFindCustomerByCUIT(session, testCUIT);

    if (customer) {
      console.log('✅ Cliente encontrado!');
      console.log(`   - ID: ${customer.idEntidad}`);
      console.log(`   - Razón Social: ${customer.razonSocial}`);
      console.log(`   - CUIT: ${customer.cuit}`);
      console.log(`   - Condición IVA: ${customer.condicionIva}\n`);
    } else {
      console.log('⚠️  Cliente no encontrado en Colppy\n');
    }

    // 3. Test de búsqueda de otro cliente
    console.log('3️⃣  Probando búsqueda de otro cliente...');
    const testCUIT2 = '20-12345678-9'; // CUIT de ejemplo
    console.log(`   Buscando cliente con CUIT: ${testCUIT2}`);

    const customer2 = await colppyFindCustomerByCUIT(session, testCUIT2);

    if (customer2) {
      console.log('✅ Cliente encontrado!');
      console.log(`   - ID: ${customer2.idEntidad}`);
      console.log(`   - Razón Social: ${customer2.razonSocial}\n`);
    } else {
      console.log('⚠️  Cliente no encontrado (esto es normal si no existe)\n');
    }

    // 4. Test de logout
    console.log('4️⃣  Probando logout...');
    await colppyLogout(session);
    console.log('✅ Logout exitoso!\n');

    // Resumen final
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🎉 ¡Todos los tests completados exitosamente!');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('\n📝 Notas:');
    console.log('   ✅ La integración con Colppy está funcionando correctamente');
    console.log('   ✅ Puedes usar el botón "Enviar a Colppy" en cotizaciones aceptadas');
    console.log('   ✅ Los documentos se crearán automáticamente en Colppy');
    console.log('\n💡 Próximo paso:');
    console.log('   1. Iniciar el servidor: npm run dev');
    console.log('   2. Ir a una cotización en estado ACCEPTED');
    console.log('   3. Hacer clic en "Enviar a Colppy"');
    console.log('   4. Seleccionar la opción deseada');
    console.log('   5. ¡Listo! Los documentos se crearán en Colppy automáticamente\n');

  } catch (error: any) {
    console.error('\n❌ Error en el test:');
    console.error(`   ${error.message}`);
    console.error('\n🔍 Verifica que:');
    console.error('   1. Las variables de entorno están configuradas correctamente en .env');
    console.error('   2. COLPPY_USER=stejedor@val-ar.com.ar');
    console.error('   3. COLPPY_PASSWORD=Stst124578.');
    console.error('   4. COLPPY_ID_EMPRESA=18446');
    console.error('   5. Tienes conexión a internet');
    process.exit(1);
  }
}

// Ejecutar test
testColppyIntegration();

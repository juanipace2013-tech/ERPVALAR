/**
 * Script de prueba para el flujo de estados de cotizaciones
 *
 * Uso: npx tsx scripts/test-quote-workflow.ts
 */

import { prisma } from '../src/lib/prisma'
import { updateQuoteStatus } from '../src/lib/quote-workflow'

async function testQuoteWorkflow() {
  console.log('🧪 Iniciando prueba de flujo de cotizaciones...\n')

  try {
    // 1. Buscar una cotización en estado DRAFT
    console.log('1️⃣ Buscando cotización en estado DRAFT...')
    let quote = await prisma.quote.findFirst({
      where: { status: 'DRAFT' },
      include: { customer: true, salesPerson: true }
    })

    if (!quote) {
      console.log('   ⚠️  No se encontró ninguna cotización en DRAFT')
      console.log('   💡 Crear una cotización de prueba primero\n')
      return
    }

    console.log(`   ✅ Encontrada: ${quote.quoteNumber}`)
    console.log(`   📋 Cliente: ${quote.customer.name}`)
    console.log(`   📊 Estado actual: ${quote.status}\n`)

    // 2. Cambiar a SENT
    console.log('2️⃣ Cambiando estado a SENT (Enviada)...')
    try {
      quote = await updateQuoteStatus(
        quote.id,
        'SENT',
        quote.salesPersonId,
        {}
      )
      console.log(`   ✅ Estado actualizado a: ${quote.status}\n`)
    } catch (error) {
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : 'Error desconocido'}\n`)
      return
    }

    // 3. Intentar cambio inválido (SENT → DRAFT) - debe fallar
    console.log('3️⃣ Probando transición inválida (SENT → DRAFT)...')
    try {
      await updateQuoteStatus(
        quote.id,
        'DRAFT',
        quote.salesPersonId,
        {}
      )
      console.log(`   ❌ ERROR: Se permitió una transición inválida!\n`)
    } catch (error) {
      console.log(`   ✅ Validación correcta: ${error instanceof Error ? error.message : 'Error desconocido'}\n`)
    }

    // 4. Cambiar a ACCEPTED
    console.log('4️⃣ Cambiando estado a ACCEPTED (Aceptada)...')
    try {
      quote = await updateQuoteStatus(
        quote.id,
        'ACCEPTED',
        quote.salesPersonId,
        {
          customerResponse: 'Cliente aceptó la cotización por email'
        }
      )
      console.log(`   ✅ Estado actualizado a: ${quote.status}`)
      console.log(`   💬 Respuesta del cliente: ${quote.customerResponse}\n`)
    } catch (error) {
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : 'Error desconocido'}\n`)
      return
    }

    // 5. Verificar historial
    console.log('5️⃣ Verificando historial de estados...')
    const history = await prisma.quoteStatusHistory.findMany({
      where: { quoteId: quote.id },
      orderBy: { createdAt: 'asc' }
    })

    console.log(`   📜 Registros en historial: ${history.length}`)
    history.forEach((record, index) => {
      console.log(`   ${index + 1}. ${record.fromStatus} → ${record.toStatus}`)
      if (record.notes) {
        console.log(`      💬 ${record.notes}`)
      }
    })
    console.log('')

    // 6. Resumen final
    console.log('✅ Prueba completada exitosamente!\n')
    console.log('📊 RESUMEN:')
    console.log(`   Cotización: ${quote.quoteNumber}`)
    console.log(`   Estado final: ${quote.status}`)
    console.log(`   Total de cambios: ${history.length}`)
    console.log('')
    console.log('💡 SIGUIENTES PASOS:')
    console.log('   1. Acceder a http://localhost:3000/cotizaciones/' + quote.id + '/ver')
    console.log('   2. Verificar que se muestren los botones correctos')
    console.log('   3. Probar generar factura desde la UI')
    console.log('')

  } catch (error) {
    console.error('❌ Error en la prueba:', error)
  } finally {
    await prisma.$disconnect()
  }
}

// Ejecutar prueba
testQuoteWorkflow()
  .catch(console.error)

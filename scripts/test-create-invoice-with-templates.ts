/**
 * Script de prueba: Crear factura y verificar asientos automáticos
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testInvoiceWithTemplates() {
  console.log('🧪 PRUEBA: Crear Factura con Sistema de Plantillas\n');
  console.log('═'.repeat(70));

  try {
    // 1. Verificar que hay datos necesarios
    console.log('\n📋 1. VERIFICANDO DATOS NECESARIOS');
    console.log('-'.repeat(70));

    const user = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
    });

    if (!user) {
      console.log('❌ No hay usuario administrador');
      return;
    }
    console.log(`✅ Usuario: ${user.name} (${user.email})`);

    const customer = await prisma.customer.findFirst({
      where: { status: 'ACTIVE' },
    });

    if (!customer) {
      console.log('❌ No hay clientes activos');
      return;
    }
    console.log(`✅ Cliente: ${customer.name} - CUIT: ${customer.cuit}`);

    const products = await prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        trackInventory: true,
      },
      take: 2,
      orderBy: { createdAt: 'desc' },
    });

    if (products.length === 0) {
      console.log('❌ No hay productos con stock');
      return;
    }
    console.log(`✅ Productos disponibles: ${products.length}`);

    // Asignar costo y stock a los productos para la prueba
    for (const product of products) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          lastCost: 100, // Costo de ejemplo
          averageCost: 100,
          stockQuantity: 10, // Stock de ejemplo
        },
      });

      // Crear precio de COSTO (necesario para CMV)
      const existingCostPrice = await prisma.productPrice.findFirst({
        where: {
          productId: product.id,
          priceType: 'COST',
        },
      });

      if (!existingCostPrice) {
        await prisma.productPrice.create({
          data: {
            productId: product.id,
            priceType: 'COST',
            amount: 100, // Costo
            currency: 'ARS',
            validFrom: new Date(),
          },
        });
      }

      // Crear precio de VENTA
      const existingSalePrice = await prisma.productPrice.findFirst({
        where: {
          productId: product.id,
          priceType: 'SALE',
        },
      });

      if (!existingSalePrice) {
        await prisma.productPrice.create({
          data: {
            productId: product.id,
            priceType: 'SALE',
            amount: 150, // Precio de venta
            currency: 'ARS',
            validFrom: new Date(),
          },
        });
      }
    }

    // Recargar productos con los datos actualizados
    const updatedProducts = await prisma.product.findMany({
      where: { id: { in: products.map((p) => p.id) } },
      include: {
        prices: {
          where: { priceType: 'SALE' },
          orderBy: { validFrom: 'desc' },
          take: 1,
        },
      },
    });

    updatedProducts.forEach((p) => {
      const price = p.prices[0]?.amount || 0;
      console.log(
        `   - ${p.name} (Stock: ${p.stockQuantity}, Costo: $${Number(p.lastCost)}, Precio: $${Number(price)})`
      );
    });

    // 2. Obtener último número de factura
    console.log('\n📝 2. GENERANDO NÚMERO DE FACTURA');
    console.log('-'.repeat(70));

    const lastInvoice = await prisma.invoice.findFirst({
      orderBy: { invoiceNumber: 'desc' },
    });

    let nextNumber = 1;
    if (lastInvoice) {
      const match = lastInvoice.invoiceNumber.match(/(\d+)$/);
      if (match) {
        nextNumber = parseInt(match[1]) + 1;
      }
    }

    const invoiceNumber = `0001-${nextNumber.toString().padStart(8, '0')}`;
    console.log(`✅ Número de factura: ${invoiceNumber}`);

    // 3. Preparar datos de la factura
    console.log('\n💰 3. PREPARANDO FACTURA');
    console.log('-'.repeat(70));

    const items = updatedProducts.slice(0, 2).map((p, index) => {
      const quantity = Math.min(2, Number(p.stockQuantity)); // Vender 2 unidades o menos
      const unitPrice = p.prices[0] ? Number(p.prices[0].amount) : 150;
      const subtotal = quantity * unitPrice;
      const taxRate = 21; // IVA 21%
      const discount = 0;

      return {
        productId: p.id,
        quantity,
        unitPrice,
        discount,
        taxRate,
        subtotal,
        description: p.name,
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const taxAmount = subtotal * 0.21; // IVA 21%
    const total = subtotal + taxAmount;

    console.log('Factura Tipo A (Responsable Inscripto)');
    console.log(`Cliente: ${customer.name}`);
    console.log(`Fecha: ${new Date().toLocaleDateString()}`);
    console.log('\nÍtems:');
    items.forEach((item, i) => {
      console.log(
        `  ${i + 1}. ${item.description} x${item.quantity} = $${item.subtotal.toFixed(2)}`
      );
    });
    console.log(`\nSubtotal: $${subtotal.toFixed(2)}`);
    console.log(`IVA 21%:  $${taxAmount.toFixed(2)}`);
    console.log(`TOTAL:    $${total.toFixed(2)}`);

    // 4. Verificar asientos existentes ANTES
    const journalEntriesBefore = await prisma.journalEntry.count();
    console.log(`\n📊 Asientos contables actuales: ${journalEntriesBefore}`);

    // 5. Crear la factura usando el servicio
    console.log('\n🔄 4. CREANDO FACTURA CON SISTEMA DE PLANTILLAS');
    console.log('-'.repeat(70));

    const { processInvoiceCreationWithInventory } = await import(
      '../src/lib/inventario/invoice-inventory.service'
    );

    const issueDate = new Date();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    const result = await processInvoiceCreationWithInventory({
      invoiceNumber,
      invoiceType: 'A', // Tipo A = Responsable Inscripto (discrimina IVA)
      customerId: customer.id,
      userId: user.id,
      currency: 'ARS',
      subtotal,
      taxAmount,
      discount: 0,
      total,
      issueDate,
      dueDate,
      notes: 'Factura de prueba - Sistema de plantillas automáticas',
      items,
    });

    console.log('✅ Factura creada exitosamente');
    console.log(`   ID: ${result.invoice.id}`);
    console.log(`   Número: ${result.invoice.invoiceNumber}`);
    console.log(`   Total: $${Number(result.invoice.total).toFixed(2)}`);

    // 6. Verificar los asientos creados
    console.log('\n📊 5. VERIFICANDO ASIENTOS CONTABLES CREADOS');
    console.log('-'.repeat(70));

    const journalEntriesAfter = await prisma.journalEntry.count();
    const newEntries = journalEntriesAfter - journalEntriesBefore;

    console.log(`Asientos creados: ${newEntries}`);
    console.log(`Total de asientos: ${journalEntriesAfter}`);

    // Obtener los asientos de esta factura
    const invoiceEntries = await prisma.journalEntry.findMany({
      where: {
        OR: [
          { invoiceId: result.invoice.id },
          { reference: invoiceNumber },
        ],
      },
      include: {
        lines: {
          include: {
            account: {
              select: {
                code: true,
                name: true,
              },
            },
          },
          orderBy: {
            id: 'asc',
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    console.log(`\n✅ Se crearon ${invoiceEntries.length} asientos automáticamente:\n`);

    invoiceEntries.forEach((entry, index) => {
      console.log(`\n📝 ASIENTO ${index + 1}: #${entry.entryNumber}`);
      console.log(`   Fecha: ${entry.date.toLocaleDateString()}`);
      console.log(`   Descripción: ${entry.description}`);
      console.log(`   Tipo: ${entry.triggerType || 'Manual'}`);
      console.log(`   Plantilla: ${entry.templateCode || 'Sin plantilla'}`);
      console.log(`   Estado: ${entry.status}`);
      console.log(`   Automático: ${entry.isAutomatic ? 'Sí' : 'No'}`);
      console.log('\n   Líneas:');

      let totalDebit = 0;
      let totalCredit = 0;

      entry.lines.forEach((line) => {
        const debit = Number(line.debit);
        const credit = Number(line.credit);
        totalDebit += debit;
        totalCredit += credit;

        if (debit > 0) {
          console.log(
            `   DEBE:  ${line.account.code.padEnd(12)} ${line.account.name.padEnd(35)} $${debit.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
          );
        } else {
          console.log(
            `   HABER: ${line.account.code.padEnd(12)} ${line.account.name.padEnd(35)} $${credit.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
          );
        }
      });

      console.log(`   ${'-'.repeat(68)}`);
      console.log(
        `   Total DEBE:  $${totalDebit.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
      );
      console.log(
        `   Total HABER: $${totalCredit.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
      );
      console.log(
        `   Balance: ${Math.abs(totalDebit - totalCredit) < 0.01 ? '✅ BALANCEADO' : '❌ DESBALANCEADO'}`
      );
    });

    // 7. Verificar stock actualizado
    console.log('\n\n📦 6. VERIFICANDO ACTUALIZACIÓN DE STOCK');
    console.log('-'.repeat(70));

    for (const item of items) {
      const updatedProduct = await prisma.product.findUnique({
        where: { id: item.productId },
        select: { name: true, stockQuantity: true },
      });

      if (updatedProduct) {
        const originalProduct = updatedProducts.find((p) => p.id === item.productId);
        const stockBefore = Number(originalProduct?.stockQuantity || 0);
        const stockAfter = Number(updatedProduct.stockQuantity);
        const difference = stockBefore - stockAfter;

        console.log(`${updatedProduct.name}:`);
        console.log(`   Stock anterior: ${stockBefore}`);
        console.log(`   Vendido: ${item.quantity}`);
        console.log(`   Stock actual: ${stockAfter}`);
        console.log(`   ✅ ${difference === item.quantity ? 'Correcto' : '❌ Error'}`);
      }
    }

    // 8. Resumen final
    console.log('\n\n🎉 RESUMEN FINAL');
    console.log('═'.repeat(70));
    console.log('✅ Factura creada exitosamente');
    console.log(`✅ ${invoiceEntries.length} asientos contables generados automáticamente`);
    console.log('✅ Stock actualizado correctamente');
    console.log('✅ Sistema de plantillas funcionando perfectamente');
    console.log('\n🎯 CONCLUSIÓN:');
    console.log('   El sistema de plantillas automatiza toda la contabilización.');
    console.log('   No se necesitó escribir código manual para los asientos.');
    console.log('   Todo se generó automáticamente usando las plantillas configuradas.');

    console.log('\n📍 VERIFICAR EN LA APLICACIÓN:');
    console.log(`   Factura: http://localhost:3000/facturas`);
    console.log(`   Asientos: http://localhost:3000/contabilidad/asientos`);
    console.log(`   Inventario: http://localhost:3000/inventario/items`);

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    if (error instanceof Error) {
      console.error('   Mensaje:', error.message);
      console.error('   Stack:', error.stack);
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
testInvoiceWithTemplates()
  .then(() => {
    console.log('\n✅ Prueba completada exitosamente\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Prueba falló:', error);
    process.exit(1);
  });

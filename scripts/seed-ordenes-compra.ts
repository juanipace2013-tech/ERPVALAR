import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Creando órdenes de compra de prueba...\n')

  // Obtener primer usuario
  const user = await prisma.user.findFirst()
  if (!user) {
    throw new Error('No hay usuarios en la base de datos')
  }

  // Obtener primer proveedor
  const supplier = await prisma.supplier.findFirst()
  if (!supplier) {
    throw new Error('No hay proveedores en la base de datos')
  }

  // Obtener primeros 3 productos
  const products = await prisma.product.findMany({ take: 3 })
  if (products.length === 0) {
    throw new Error('No hay productos en la base de datos')
  }

  console.log(`👤 Usuario: ${user.name}`)
  console.log(`🏢 Proveedor: ${supplier.name}`)
  console.log(`📦 Productos: ${products.length}\n`)

  // Crear Orden de Compra 1 - APROBADA
  const order1 = await prisma.purchaseOrder.create({
    data: {
      orderNumber: 'OC-2026-0001',
      supplierId: supplier.id,
      userId: user.id,
      status: 'APPROVED',
      currency: 'ARS',
      subtotal: 15000,
      taxAmount: 3150,
      discount: 0,
      total: 18150,
      orderDate: new Date('2026-01-15'),
      expectedDate: new Date('2026-02-15'),
      items: {
        create: products.slice(0, 2).map((product, idx) => ({
          productId: product.id,
          quantity: 10 + idx * 5,
          receivedQty: 0,
          unitCost: 500 + idx * 200,
          discount: 0,
          taxRate: 21,
          subtotal: (10 + idx * 5) * (500 + idx * 200),
        })),
      },
    },
  })

  console.log(`✅ ${order1.orderNumber} - Total: $${order1.total}`)

  // Actualizar saldo del proveedor
  await prisma.supplier.update({
    where: { id: supplier.id },
    data: { balance: { increment: Number(order1.total) } },
  })

  // Crear Orden de Compra 2 - RECIBIDA
  const order2 = await prisma.purchaseOrder.create({
    data: {
      orderNumber: 'OC-2026-0002',
      supplierId: supplier.id,
      userId: user.id,
      status: 'RECEIVED',
      currency: 'ARS',
      subtotal: 8000,
      taxAmount: 1680,
      discount: 0,
      total: 9680,
      orderDate: new Date('2026-01-20'),
      expectedDate: new Date('2026-02-20'),
      receivedDate: new Date('2026-02-10'),
      items: {
        create: [
          {
            productId: products[0].id,
            quantity: 20,
            receivedQty: 20,
            unitCost: 400,
            discount: 0,
            taxRate: 21,
            subtotal: 8000,
          },
        ],
      },
    },
  })

  console.log(`✅ ${order2.orderNumber} - Total: $${order2.total}`)

  await prisma.supplier.update({
    where: { id: supplier.id },
    data: { balance: { increment: Number(order2.total) } },
  })

  // Crear Pago 1 - Pago parcial de orden 1
  const payment1 = await prisma.supplierPayment.create({
    data: {
      supplierId: supplier.id,
      purchaseOrderId: order1.id,
      userId: user.id,
      amount: 10000,
      currency: 'ARS',
      method: 'TRANSFER',
      paymentDate: new Date('2026-01-25'),
      reference: 'TRANSF-001234',
      notes: 'Pago parcial orden OC-2026-0001',
    },
  })

  console.log(`✅ Pago de $${payment1.amount} registrado`)

  // Actualizar saldo del proveedor y paidAmount de la orden
  await prisma.supplier.update({
    where: { id: supplier.id },
    data: { balance: { decrement: Number(payment1.amount) } },
  })

  await prisma.purchaseOrder.update({
    where: { id: order1.id },
    data: { paidAmount: { increment: Number(payment1.amount) } },
  })

  // Crear Pago 2 - Pago total de orden 2
  const payment2 = await prisma.supplierPayment.create({
    data: {
      supplierId: supplier.id,
      purchaseOrderId: order2.id,
      userId: user.id,
      amount: 9680,
      currency: 'ARS',
      method: 'TRANSFER',
      paymentDate: new Date('2026-02-12'),
      reference: 'TRANSF-001235',
      notes: 'Pago completo orden OC-2026-0002',
    },
  })

  console.log(`✅ Pago de $${payment2.amount} registrado`)

  await prisma.supplier.update({
    where: { id: supplier.id },
    data: { balance: { decrement: Number(payment2.amount) } },
  })

  await prisma.purchaseOrder.update({
    where: { id: order2.id },
    data: { paidAmount: { increment: Number(payment2.amount) } },
  })

  // Obtener saldo final
  const updatedSupplier = await prisma.supplier.findUnique({
    where: { id: supplier.id },
  })

  console.log(`\n✨ Seed completado!\n`)
  console.log(`📊 Resumen:`)
  console.log(`   - 2 órdenes de compra creadas`)
  console.log(`   - Total comprado: $${Number(order1.total) + Number(order2.total)}`)
  console.log(`   - Total pagado: $${Number(payment1.amount) + Number(payment2.amount)}`)
  console.log(`   - Saldo actual: $${updatedSupplier?.balance}\n`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('❌ Error:', e)
    await prisma.$disconnect()
    process.exit(1)
  })

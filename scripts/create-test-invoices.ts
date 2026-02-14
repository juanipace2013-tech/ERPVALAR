import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🧾 Creando facturas de prueba...\n')

  // Buscar el cliente ACME Corporation
  const customer = await prisma.customer.findFirst({
    where: { name: { contains: 'ACME' } },
  })

  if (!customer) {
    console.log('❌ Cliente ACME no encontrado. Ejecuta primero: npx ts-node scripts/test-create-customer.ts\n')
    process.exit(1)
  }

  console.log(`✅ Cliente encontrado: ${customer.name} (${customer.id})\n`)

  // Buscar un usuario para asignar las facturas
  const user = await prisma.user.findFirst({
    where: { email: 'admin@valarg.com' },
  })

  if (!user) {
    console.log('❌ Usuario admin no encontrado\n')
    process.exit(1)
  }

  // Buscar o crear productos
  let product1 = await prisma.product.findFirst({
    where: { sku: 'PROD-001' },
  })

  if (!product1) {
    console.log('Creando producto 1...')
    product1 = await prisma.product.create({
      data: {
        sku: 'PROD-001',
        name: 'Servicio de Consultoría',
        description: 'Servicio profesional de consultoría',
        type: 'SERVICE',
        unit: 'hora',
        status: 'ACTIVE',
        stockQuantity: 0,
        minStock: 0,
      },
    })

    // Crear precio para el producto
    await prisma.productPrice.create({
      data: {
        productId: product1.id,
        priceType: 'SALE',
        amount: 5000,
        currency: 'ARS',
        validFrom: new Date(),
      },
    })
  }

  let product2 = await prisma.product.findFirst({
    where: { sku: 'PROD-002' },
  })

  if (!product2) {
    console.log('Creando producto 2...')
    product2 = await prisma.product.create({
      data: {
        sku: 'PROD-002',
        name: 'Desarrollo de Software',
        description: 'Servicio de desarrollo de software a medida',
        type: 'SERVICE',
        unit: 'hora',
        status: 'ACTIVE',
        stockQuantity: 0,
        minStock: 0,
      },
    })

    // Crear precio para el producto
    await prisma.productPrice.create({
      data: {
        productId: product2.id,
        priceType: 'SALE',
        amount: 8000,
        currency: 'ARS',
        validFrom: new Date(),
      },
    })
  }

  console.log('✅ Productos listos\n')

  // Crear 3 facturas
  const invoices = []

  // Factura 1 - Pagada (hace 60 días)
  const invoice1Date = new Date()
  invoice1Date.setDate(invoice1Date.getDate() - 60)

  const invoice1 = await prisma.invoice.create({
    data: {
      invoiceNumber: 'A-0001-00000001',
      invoiceType: 'A',
      customerId: customer.id,
      userId: user.id,
      status: 'PAID',
      currency: 'ARS',
      subtotal: 25000,
      taxAmount: 5250,
      discount: 0,
      total: 30250,
      issueDate: invoice1Date,
      dueDate: new Date(invoice1Date.getTime() + 30 * 24 * 60 * 60 * 1000),
      paidDate: new Date(invoice1Date.getTime() + 15 * 24 * 60 * 60 * 1000),
      notes: 'Factura pagada - Servicios de consultoría',
      items: {
        create: [
          {
            productId: product1.id,
            quantity: 5,
            unitPrice: 5000,
            discount: 0,
            taxRate: 21,
            subtotal: 25000,
            description: 'Consultoría proyecto inicial',
          },
        ],
      },
    },
    include: { items: true },
  })

  invoices.push(invoice1)
  console.log(`✅ Factura ${invoice1.invoiceNumber} creada - PAGADA`)

  // Factura 2 - Autorizada pendiente de pago (hace 15 días, vence en 15 días)
  const invoice2Date = new Date()
  invoice2Date.setDate(invoice2Date.getDate() - 15)

  const invoice2 = await prisma.invoice.create({
    data: {
      invoiceNumber: 'A-0001-00000002',
      invoiceType: 'A',
      customerId: customer.id,
      userId: user.id,
      status: 'AUTHORIZED',
      currency: 'ARS',
      subtotal: 64000,
      taxAmount: 13440,
      discount: 0,
      total: 77440,
      issueDate: invoice2Date,
      dueDate: new Date(invoice2Date.getTime() + 30 * 24 * 60 * 60 * 1000),
      notes: 'Factura pendiente - Desarrollo de software',
      items: {
        create: [
          {
            productId: product2.id,
            quantity: 8,
            unitPrice: 8000,
            discount: 0,
            taxRate: 21,
            subtotal: 64000,
            description: 'Desarrollo módulo de ventas',
          },
        ],
      },
    },
    include: { items: true },
  })

  invoices.push(invoice2)
  console.log(`✅ Factura ${invoice2.invoiceNumber} creada - PENDIENTE DE PAGO`)

  // Factura 3 - Vencida (hace 45 días, venció hace 15 días)
  const invoice3Date = new Date()
  invoice3Date.setDate(invoice3Date.getDate() - 45)

  const invoice3 = await prisma.invoice.create({
    data: {
      invoiceNumber: 'A-0001-00000003',
      invoiceType: 'A',
      customerId: customer.id,
      userId: user.id,
      status: 'SENT',
      currency: 'ARS',
      subtotal: 40000,
      taxAmount: 8400,
      discount: 0,
      total: 48400,
      issueDate: invoice3Date,
      dueDate: new Date(invoice3Date.getTime() + 30 * 24 * 60 * 60 * 1000),
      notes: 'Factura vencida - Servicios mixtos',
      items: {
        create: [
          {
            productId: product1.id,
            quantity: 4,
            unitPrice: 5000,
            discount: 0,
            taxRate: 21,
            subtotal: 20000,
            description: 'Consultoría seguimiento',
          },
          {
            productId: product2.id,
            quantity: 2.5,
            unitPrice: 8000,
            discount: 0,
            taxRate: 21,
            subtotal: 20000,
            description: 'Desarrollo módulo reportes',
          },
        ],
      },
    },
    include: { items: true },
  })

  invoices.push(invoice3)
  console.log(`✅ Factura ${invoice3.invoiceNumber} creada - VENCIDA\n`)

  // Actualizar balance del cliente
  const totalPending = Number(invoice2.total) + Number(invoice3.total)
  await prisma.customer.update({
    where: { id: customer.id },
    data: { balance: totalPending },
  })

  console.log('📊 Resumen de facturas creadas:')
  console.log('─────────────────────────────────────────')
  invoices.forEach((inv) => {
    console.log(`${inv.invoiceNumber} - $ ${Number(inv.total).toFixed(2)} - ${inv.status}`)
  })
  console.log('─────────────────────────────────────────')
  console.log(`💰 Balance del cliente actualizado: $ ${totalPending.toFixed(2)}\n`)
  console.log('✅ Facturas de prueba creadas exitosamente!\n')
  console.log('🌐 Ahora puedes ver los movimientos de cuenta en:')
  console.log(`   http://localhost:3000/clientes/${customer.id}`)
  console.log('   (Tab: Cuenta cliente)\n')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

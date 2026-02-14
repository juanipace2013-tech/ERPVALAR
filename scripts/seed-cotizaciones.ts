import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding cotizaciones data...')

  // 1. Crear descuentos por marca
  console.log('\n📊 Creando descuentos por marca...')

  const brandDiscounts = [
    { brand: 'GENEBRE', discountPercent: 15 },
    { brand: 'WINTERS', discountPercent: 10 },
    { brand: 'CEPEX', discountPercent: 12 },
    { brand: 'BERMAD', discountPercent: 8 },
    { brand: 'WATTS', discountPercent: 10 },
  ]

  for (const bd of brandDiscounts) {
    await prisma.brandDiscount.upsert({
      where: { brand: bd.brand },
      update: { discountPercent: bd.discountPercent },
      create: bd,
    })
    console.log(`  ✓ ${bd.brand}: ${bd.discountPercent}% descuento`)
  }

  // 2. Obtener o crear categoría
  const category = await prisma.category.findFirst({
    where: { name: 'Válvulas' },
  })

  let categoryId: string | undefined = category?.id

  if (!category) {
    const newCategory = await prisma.category.create({
      data: {
        name: 'Válvulas',
        description: 'Válvulas industriales',
      },
    })
    categoryId = newCategory.id
    console.log('\n✓ Categoría "Válvulas" creada')
  }

  // 3. Crear productos VAL ARG con precios USD
  console.log('\n🔧 Creando productos VAL ARG...')

  const products = [
    {
      sku: '2025-04',
      name: 'VÁLV. ESF. INOX. P.TOTAL 3 PZAS 1/2" M. DIRECTO',
      brand: 'GENEBRE',
      listPriceUSD: 769.79,
      type: 'PRODUCT',
      unit: 'UN',
      stockQuantity: 25,
      minStock: 5,
      categoryId,
    },
    {
      sku: '2026-11',
      name: 'VÁLVULA ESFÉRICA BRONCE 1" PASO TOTAL',
      brand: 'GENEBRE',
      listPriceUSD: 324.50,
      type: 'PRODUCT',
      unit: 'UN',
      stockQuantity: 50,
      minStock: 10,
      categoryId,
    },
    {
      sku: '2027-15',
      name: 'VÁLVULA MARIPOSA PVC-U DN50 2"',
      brand: 'CEPEX',
      listPriceUSD: 156.30,
      type: 'PRODUCT',
      unit: 'UN',
      stockQuantity: 30,
      minStock: 8,
      categoryId,
    },
    {
      sku: '2028-22',
      name: 'MANÓMETRO GLICERINA 0-10 BAR 1/4" POST',
      brand: 'WINTERS',
      listPriceUSD: 45.80,
      type: 'PRODUCT',
      unit: 'UN',
      stockQuantity: 100,
      minStock: 20,
      categoryId,
    },
    {
      sku: '9001-01',
      name: 'JUNTA TEFLÓN 1/2"',
      brand: 'GENÉRICO',
      listPriceUSD: 2.50,
      type: 'PRODUCT',
      unit: 'UN',
      stockQuantity: 500,
      minStock: 100,
      categoryId,
    },
    {
      sku: '9001-02',
      name: 'TORNILLO INOX M8x30',
      brand: 'GENÉRICO',
      listPriceUSD: 0.75,
      type: 'PRODUCT',
      unit: 'UN',
      stockQuantity: 1000,
      minStock: 200,
      categoryId,
    },
  ]

  for (const product of products) {
    const existing = await prisma.product.findUnique({
      where: { sku: product.sku },
    })

    if (existing) {
      await prisma.product.update({
        where: { sku: product.sku },
        data: {
          name: product.name,
          brand: product.brand,
          listPriceUSD: product.listPriceUSD,
          stockQuantity: product.stockQuantity,
          minStock: product.minStock,
        },
      })
      console.log(`  ↻ ${product.sku} - ${product.name} (actualizado)`)
    } else {
      await prisma.product.create({
        data: product,
      })
      console.log(`  ✓ ${product.sku} - ${product.name}`)
    }
  }

  // 4. Actualizar clientes con multiplicadores de precio
  console.log('\n👥 Actualizando clientes con multiplicadores...')

  const customers = await prisma.customer.findMany({
    take: 3,
  })

  if (customers.length > 0) {
    const multipliers = [1.0, 1.2, 1.5]

    for (let i = 0; i < Math.min(customers.length, 3); i++) {
      await prisma.customer.update({
        where: { id: customers[i].id },
        data: {
          priceMultiplier: multipliers[i],
          paymentTerms: 30,
        },
      })
      console.log(
        `  ✓ ${customers[i].name}: Multiplicador ${multipliers[i]} (${
          multipliers[i] === 1.0
            ? 'precio base'
            : multipliers[i] === 1.2
            ? '+20%'
            : '+50%'
        })`
      )
    }
  } else {
    console.log('  ⚠ No hay clientes para actualizar')
  }

  // 5. Obtener tipo de cambio actual
  console.log('\n💱 Obteniendo tipo de cambio...')

  const exchangeRate = await prisma.exchangeRate.findFirst({
    where: {
      fromCurrency: 'USD',
      toCurrency: 'ARS',
    },
    orderBy: {
      validFrom: 'desc',
    },
  })

  const tcRate = exchangeRate?.rate || 1050.0
  console.log(`  ✓ USD/ARS: $${tcRate}`)

  // 6. Crear cotización de ejemplo (si hay datos)
  if (customers.length > 0) {
    console.log('\n📋 Creando cotización de ejemplo...')

    const admin = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
    })

    if (!admin) {
      console.log('  ⚠ No hay usuarios ADMIN, saltando cotización')
      return
    }

    const productMain = await prisma.product.findFirst({
      where: { sku: '2025-04' },
    })
    const productAdd1 = await prisma.product.findFirst({
      where: { sku: '9001-01' },
    })
    const productAdd2 = await prisma.product.findFirst({
      where: { sku: '9001-02' },
    })

    if (!productMain || !productAdd1 || !productAdd2) {
      console.log('  ⚠ Productos no encontrados, saltando cotización')
      return
    }

    // Buscar si ya existe una cotización
    const existingQuote = await prisma.quote.findFirst({
      where: {
        quoteNumber: 'VAL-2026-001',
      },
    })

    if (existingQuote) {
      console.log('  ↻ Cotización VAL-2026-001 ya existe')
      return
    }

    // Obtener descuento de marca
    const genebereDiscount = await prisma.brandDiscount.findUnique({
      where: { brand: 'GENEBRE' },
    })

    const brandDiscountValue = genebereDiscount
      ? Number(genebereDiscount.discountPercent) / 100
      : 0.15

    // Calcular precios según fórmula VAL ARG:
    // Precio Final = (Precio Lista + Sum(Adicionales)) × (1 - Descuento Marca) × Multiplicador Cliente

    const listPrice = Number(productMain.listPriceUSD!)
    const add1Price = Number(productAdd1.listPriceUSD!)
    const add2Price = Number(productAdd2.listPriceUSD!)

    const subtotalWithAdditionals = listPrice + add1Price + add2Price
    const afterDiscount = subtotalWithAdditionals * (1 - brandDiscountValue)
    const customerMult = Number(customers[0].priceMultiplier)
    const unitPrice = afterDiscount * customerMult

    const quantity = 10
    const totalPrice = unitPrice * quantity

    const quote = await prisma.quote.create({
      data: {
        quoteNumber: 'VAL-2026-001',
        customerId: customers[0].id,
        salesPersonId: admin.id,
        exchangeRate: tcRate,
        currency: 'USD',
        date: new Date(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 días
        terms: 'Pago: 50% anticipo, 50% contra entrega. Entrega: 15 días hábiles.',
        notes: 'Cotización de ejemplo generada automáticamente',
        subtotal: totalPrice,
        total: totalPrice,
        items: {
          create: [
            {
              itemNumber: 10,
              productId: productMain.id,
              quantity,
              listPrice,
              brandDiscount: brandDiscountValue,
              customerMultiplier: customerMult,
              unitPrice,
              totalPrice,
              additionals: {
                create: [
                  {
                    productId: productAdd1.id,
                    position: 1,
                    listPrice: add1Price,
                  },
                  {
                    productId: productAdd2.id,
                    position: 2,
                    listPrice: add2Price,
                  },
                ],
              },
            },
          ],
        },
      },
      include: {
        items: {
          include: {
            additionals: true,
          },
        },
      },
    })

    console.log(`  ✓ Cotización creada: ${quote.quoteNumber}`)
    console.log(`     Cliente: ${customers[0].name}`)
    console.log(`     Items: ${quote.items.length}`)
    console.log(`     Total: USD $${Number(quote.total).toFixed(2)}`)
    console.log(
      `     Total ARS: $${(Number(quote.total) * Number(tcRate)).toLocaleString(
        'es-AR',
        {
          minimumFractionDigits: 2,
        }
      )}`
    )
  }

  console.log('\n✅ Seed de cotizaciones completado!')
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

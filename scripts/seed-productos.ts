import { PrismaClient, ProductType, Currency, PriceType, ProductStatus } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Iniciando seed de productos...')

  // Verificar si ya hay productos
  const count = await prisma.product.count()
  console.log(`📊 Productos existentes: ${count}`)

  if (count > 0) {
    console.log('✅ Ya hay productos en la base de datos')
    return
  }

  // Obtener categoría o crear una por defecto
  let category = await prisma.category.findFirst()

  if (!category) {
    console.log('📁 Creando categoría por defecto...')
    category = await prisma.category.create({
      data: {
        name: 'General',
        description: 'Categoría general',
      },
    })
  }

  // Productos de ejemplo
  const productos = [
    {
      sku: 'PROD-001',
      name: 'Notebook HP 15-DY2091 Intel Core i5',
      description: 'Notebook HP con procesador Intel Core i5, 8GB RAM, 256GB SSD',
      type: ProductType.PRODUCT,
      unit: 'UN',
      stockQuantity: 25,
      minStock: 5,
      maxStock: 100,
      status: ProductStatus.ACTIVE,
      trackInventory: true,
      allowNegative: false,
      brand: 'HP',
      isTaxable: true,
      taxRate: 21.0,
      lastCost: 450000,
      averageCost: 450000,
      prices: [
        { priceType: PriceType.COST, amount: 450000, currency: Currency.ARS },
        { priceType: PriceType.SALE, amount: 650000, currency: Currency.ARS },
      ],
    },
    {
      sku: 'PROD-002',
      name: 'Mouse Logitech MX Master 3',
      description: 'Mouse inalámbrico ergonómico para productividad',
      type: ProductType.PRODUCT,
      unit: 'UN',
      stockQuantity: 50,
      minStock: 10,
      maxStock: 200,
      status: ProductStatus.ACTIVE,
      trackInventory: true,
      allowNegative: false,
      brand: 'Logitech',
      isTaxable: true,
      taxRate: 21.0,
      lastCost: 35000,
      averageCost: 35000,
      prices: [
        { priceType: PriceType.COST, amount: 35000, currency: Currency.ARS },
        { priceType: PriceType.SALE, amount: 52000, currency: Currency.ARS },
      ],
    },
    {
      sku: 'PROD-003',
      name: 'Monitor Samsung 27" 4K',
      description: 'Monitor LED 27 pulgadas resolución 4K UHD',
      type: ProductType.PRODUCT,
      unit: 'UN',
      stockQuantity: 15,
      minStock: 3,
      maxStock: 50,
      status: ProductStatus.ACTIVE,
      trackInventory: true,
      allowNegative: false,
      brand: 'Samsung',
      isTaxable: true,
      taxRate: 21.0,
      lastCost: 180000,
      averageCost: 180000,
      prices: [
        { priceType: PriceType.COST, amount: 180000, currency: Currency.ARS },
        { priceType: PriceType.SALE, amount: 270000, currency: Currency.ARS },
      ],
    },
    {
      sku: 'SERV-001',
      name: 'Soporte Técnico Remoto',
      description: 'Servicio de soporte técnico remoto por hora',
      type: ProductType.SERVICE,
      unit: 'HS',
      stockQuantity: 0,
      minStock: 0,
      status: ProductStatus.ACTIVE,
      trackInventory: false,
      allowNegative: false,
      isTaxable: true,
      taxRate: 21.0,
      prices: [
        { priceType: PriceType.SALE, amount: 8000, currency: Currency.ARS },
      ],
    },
    {
      sku: 'PROD-004',
      name: 'Teclado Mecánico Redragon K552',
      description: 'Teclado mecánico gaming RGB',
      type: ProductType.PRODUCT,
      unit: 'UN',
      stockQuantity: 30,
      minStock: 5,
      maxStock: 100,
      status: ProductStatus.ACTIVE,
      trackInventory: true,
      allowNegative: false,
      brand: 'Redragon',
      isTaxable: true,
      taxRate: 21.0,
      lastCost: 28000,
      averageCost: 28000,
      prices: [
        { priceType: PriceType.COST, amount: 28000, currency: Currency.ARS },
        { priceType: PriceType.SALE, amount: 42000, currency: Currency.ARS },
      ],
    },
    {
      sku: 'COMBO-001',
      name: 'Combo Oficina Completo',
      description: 'Combo: Notebook + Mouse + Teclado',
      type: ProductType.COMBO,
      unit: 'UN',
      stockQuantity: 10,
      minStock: 2,
      maxStock: 30,
      status: ProductStatus.ACTIVE,
      trackInventory: true,
      allowNegative: false,
      isTaxable: true,
      taxRate: 21.0,
      lastCost: 513000,
      averageCost: 513000,
      prices: [
        { priceType: PriceType.COST, amount: 513000, currency: Currency.ARS },
        { priceType: PriceType.SALE, amount: 700000, currency: Currency.ARS },
      ],
    },
  ]

  console.log(`📦 Creando ${productos.length} productos de ejemplo...`)

  for (const prod of productos) {
    const { prices, ...productData } = prod

    const product = await prisma.product.create({
      data: {
        ...productData,
        categoryId: category.id,
        prices: {
          create: prices.map(price => ({
            ...price,
            validFrom: new Date(),
          })),
        },
      },
      include: {
        prices: true,
      },
    })

    console.log(`✅ Creado: ${product.sku} - ${product.name}`)
  }

  console.log('\n✨ Seed completado exitosamente!')
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

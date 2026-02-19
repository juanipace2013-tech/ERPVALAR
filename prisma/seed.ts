import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting seed...')

  // Limpiar datos existentes (solo en desarrollo)
  if (process.env.NODE_ENV === 'development') {
    console.log('Clearing existing data...')
    await prisma.activity.deleteMany()
    await prisma.invoiceItem.deleteMany()
    await prisma.invoice.deleteMany()
    await prisma.quoteItem.deleteMany()
    await prisma.quote.deleteMany()
    await prisma.opportunity.deleteMany()
    await prisma.contact.deleteMany()
    await prisma.customer.deleteMany()
    await prisma.productPrice.deleteMany()
    await prisma.product.deleteMany()
    await prisma.category.deleteMany()
    await prisma.exchangeRate.deleteMany()
    await prisma.session.deleteMany()
    await prisma.account.deleteMany()
    await prisma.user.deleteMany()
  }

  // ========================================
  // USUARIOS
  // ========================================
  console.log('Creating users...')

  const hashedPasswordAdmin = await bcrypt.hash('admin123', 10)
  const hashedPasswordVendedor = await bcrypt.hash('vendedor123', 10)
  const hashedPasswordGerente = await bcrypt.hash('gerente123', 10)

  const admin = await prisma.user.create({
    data: {
      name: 'Administrador',
      email: 'admin@valarg.com',
      password: hashedPasswordAdmin,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  })

  const vendedor = await prisma.user.create({
    data: {
      name: 'Juan Vendedor',
      email: 'vendedor@valarg.com',
      password: hashedPasswordVendedor,
      role: 'VENDEDOR',
      status: 'ACTIVE',
      phone: '+54 11 1234-5678',
    },
  })

  const gerente = await prisma.user.create({
    data: {
      name: 'María Gerente',
      email: 'gerente@valarg.com',
      password: hashedPasswordGerente,
      role: 'GERENTE',
      status: 'ACTIVE',
      phone: '+54 11 8765-4321',
    },
  })

  console.log(`✓ Created users: ${admin.email}, ${vendedor.email}, ${gerente.email}`)

  // ========================================
  // TIPOS DE CAMBIO
  // ========================================
  console.log('Creating exchange rates...')

  const exchangeRates = await prisma.exchangeRate.createMany({
    data: [
      // USD a ARS (dólar oficial ejemplo)
      {
        fromCurrency: 'USD',
        toCurrency: 'ARS',
        rate: 1000.00, // Ejemplo: 1 USD = 1000 ARS
        source: 'MANUAL',
        validFrom: new Date(),
      },
      // EUR a ARS
      {
        fromCurrency: 'EUR',
        toCurrency: 'ARS',
        rate: 1100.00, // Ejemplo: 1 EUR = 1100 ARS
        source: 'MANUAL',
        validFrom: new Date(),
      },
      // EUR a USD
      {
        fromCurrency: 'EUR',
        toCurrency: 'USD',
        rate: 1.10, // Ejemplo: 1 EUR = 1.10 USD
        source: 'MANUAL',
        validFrom: new Date(),
      },
      // Conversiones inversas
      {
        fromCurrency: 'ARS',
        toCurrency: 'USD',
        rate: 0.001, // 1 ARS = 0.001 USD
        source: 'MANUAL',
        validFrom: new Date(),
      },
      {
        fromCurrency: 'ARS',
        toCurrency: 'EUR',
        rate: 0.000909, // 1 ARS = 0.000909 EUR
        source: 'MANUAL',
        validFrom: new Date(),
      },
      {
        fromCurrency: 'USD',
        toCurrency: 'EUR',
        rate: 0.909, // 1 USD = 0.909 EUR
        source: 'MANUAL',
        validFrom: new Date(),
      },
    ],
  })

  console.log(`✓ Created ${exchangeRates.count} exchange rates`)

  // ========================================
  // CATEGORÍAS
  // ========================================
  console.log('Creating categories...')

  const categorias = await Promise.all([
    prisma.category.create({
      data: {
        name: 'Herramientas',
        description: 'Herramientas manuales y eléctricas',
      },
    }),
    prisma.category.create({
      data: {
        name: 'Equipamiento Industrial',
        description: 'Equipos y maquinaria para industria',
      },
    }),
    prisma.category.create({
      data: {
        name: 'Seguridad Industrial',
        description: 'Elementos de protección personal y seguridad',
      },
    }),
    prisma.category.create({
      data: {
        name: 'Ferretería',
        description: 'Artículos de ferretería en general',
      },
    }),
  ])

  console.log(`✓ Created ${categorias.length} categories`)

  // ========================================
  // PRODUCTOS DE EJEMPLO
  // ========================================
  console.log('Creating sample products...')

  const producto1 = await prisma.product.create({
    data: {
      sku: 'TOOL-001',
      name: 'Taladro Percutor 500W',
      description: 'Taladro percutor profesional de 500W con velocidad variable',
      categoryId: categorias[0].id,
      brand: 'Bosch',
      stockQuantity: 25,
      minStock: 5,
      maxStock: 100,
      unit: 'UN',
      status: 'ACTIVE',
      isTaxable: true,
      taxRate: 21,
      prices: {
        create: [
          // Precios en ARS
          {
            currency: 'ARS',
            priceType: 'COST',
            amount: 45000,
          },
          {
            currency: 'ARS',
            priceType: 'SALE',
            amount: 85000,
          },
          {
            currency: 'ARS',
            priceType: 'LIST',
            amount: 95000,
          },
          // Precios en USD
          {
            currency: 'USD',
            priceType: 'COST',
            amount: 45,
          },
          {
            currency: 'USD',
            priceType: 'SALE',
            amount: 85,
          },
          {
            currency: 'USD',
            priceType: 'LIST',
            amount: 95,
          },
        ],
      },
    },
  })

  const producto2 = await prisma.product.create({
    data: {
      sku: 'SEG-001',
      name: 'Casco de Seguridad',
      description: 'Casco de seguridad industrial con ajuste de nuca',
      categoryId: categorias[2].id,
      brand: '3M',
      stockQuantity: 150,
      minStock: 30,
      maxStock: 500,
      unit: 'UN',
      status: 'ACTIVE',
      isTaxable: true,
      taxRate: 21,
      prices: {
        create: [
          {
            currency: 'ARS',
            priceType: 'COST',
            amount: 8500,
          },
          {
            currency: 'ARS',
            priceType: 'SALE',
            amount: 15000,
          },
          {
            currency: 'ARS',
            priceType: 'WHOLESALE',
            amount: 12000,
          },
          {
            currency: 'USD',
            priceType: 'COST',
            amount: 8.5,
          },
          {
            currency: 'USD',
            priceType: 'SALE',
            amount: 15,
          },
          {
            currency: 'USD',
            priceType: 'WHOLESALE',
            amount: 12,
          },
        ],
      },
    },
  })

  const producto3 = await prisma.product.create({
    data: {
      sku: 'FER-001',
      name: 'Tornillos Autoperforantes x100',
      description: 'Caja de 100 tornillos autoperforantes 8x1"',
      categoryId: categorias[3].id,
      stockQuantity: 500,
      minStock: 50,
      maxStock: 1000,
      unit: 'CAJA',
      status: 'ACTIVE',
      isTaxable: true,
      taxRate: 21,
      prices: {
        create: [
          {
            currency: 'ARS',
            priceType: 'COST',
            amount: 2500,
          },
          {
            currency: 'ARS',
            priceType: 'SALE',
            amount: 4500,
          },
          {
            currency: 'USD',
            priceType: 'COST',
            amount: 2.5,
          },
          {
            currency: 'USD',
            priceType: 'SALE',
            amount: 4.5,
          },
        ],
      },
    },
  })

  console.log(`✓ Created 3 sample products`)

  // ========================================
  // CLIENTES DE EJEMPLO
  // ========================================
  console.log('Creating sample customers...')

  const cliente1 = await prisma.customer.create({
    data: {
      name: 'Construcciones del Sur SA',
      businessName: 'Construcciones del Sur Sociedad Anónima',
      type: 'BUSINESS',
      cuit: '30-71234567-8',
      taxCondition: 'RESPONSABLE_INSCRIPTO',
      email: 'ventas@construccionesdelsur.com',
      phone: '+54 11 4567-8900',
      mobile: '+54 9 11 5678-9012',
      address: 'Av. Libertador 1234',
      city: 'Buenos Aires',
      province: 'Buenos Aires',
      postalCode: 'C1426',
      country: 'Argentina',
      status: 'ACTIVE',
      creditLimit: 500000,
      creditCurrency: 'ARS',
      paymentTerms: 30,
      discount: 5,
      notes: 'Cliente mayorista, excelente historial de pagos',
      contacts: {
        create: [
          {
            firstName: 'Roberto',
            lastName: 'Gómez',
            position: 'Gerente de Compras',
            email: 'roberto.gomez@construccionesdelsur.com',
            phone: '+54 11 4567-8901',
            mobile: '+54 9 11 6789-0123',
            isPrimary: true,
          },
        ],
      },
    },
  })

  const cliente2 = await prisma.customer.create({
    data: {
      name: 'Industrias Metalúrgicas',
      businessName: 'Industrias Metalúrgicas Argentina SRL',
      type: 'BUSINESS',
      cuit: '30-71234568-9',
      taxCondition: 'RESPONSABLE_INSCRIPTO',
      email: 'compras@metalurgicas.com.ar',
      phone: '+54 11 4123-4567',
      address: 'Ruta 9 Km 45',
      city: 'La Plata',
      province: 'Buenos Aires',
      postalCode: 'B1900',
      country: 'Argentina',
      status: 'ACTIVE',
      creditLimit: 800000,
      creditCurrency: 'ARS',
      paymentTerms: 60,
      discount: 10,
      contacts: {
        create: [
          {
            firstName: 'Ana',
            lastName: 'Martínez',
            position: 'Jefa de Compras',
            email: 'ana.martinez@metalurgicas.com.ar',
            phone: '+54 11 4123-4568',
            isPrimary: true,
          },
        ],
      },
    },
  })

  console.log(`✓ Created 2 sample customers`)

  // ========================================
  // RESUMEN
  // ========================================
  console.log('\n✅ Seed completed successfully!')
  console.log('\n📊 Summary:')
  console.log(`   Users: 3`)
  console.log(`   - admin@valarg.com / admin123 (ADMIN)`)
  console.log(`   - vendedor@valarg.com / vendedor123 (VENDEDOR)`)
  console.log(`   - gerente@valarg.com / gerente123 (GERENTE)`)
  console.log(`   Categories: ${categorias.length}`)
  console.log(`   Products: 3`)
  console.log(`   Customers: 2`)
  console.log(`   Exchange rates: 6`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('❌ Error during seed:', e)
    await prisma.$disconnect()
    process.exit(1)
  })

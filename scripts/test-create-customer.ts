import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🧪 Probando creación de cliente...\n')

  try {
    // Obtener un usuario para asignar como vendedor
    const user = await prisma.user.findFirst({
      where: { status: 'ACTIVE' },
    })

    if (!user) {
      console.log('⚠️  No hay usuarios en la base de datos')
      console.log('   Creando usuario de prueba...\n')

      const newUser = await prisma.user.create({
        data: {
          name: 'Juan Pérez',
          email: 'juan.perez@valarg.com',
          password: '$2a$10$YourHashedPasswordHere', // En producción usar bcrypt
          role: 'VENDEDOR',
          status: 'ACTIVE',
        },
      })
      console.log(`   ✅ Usuario creado: ${newUser.name}\n`)
    }

    // Datos del cliente de prueba
    const customerData = {
      name: 'ACME Corporation',
      businessName: 'ACME Corporation S.A.',
      type: 'BUSINESS',
      cuit: '30-71234567-8',
      taxCondition: 'RESPONSABLE_INSCRIPTO',
      email: 'contacto@acme.com.ar',
      phone: '011-4567-8900',
      mobile: '11-5678-9012',
      website: 'https://www.acme.com.ar',
      address: 'Av. Corrientes 1234',
      city: 'Buenos Aires',
      province: 'CABA',
      postalCode: 'C1043',
      country: 'Argentina',
      status: 'ACTIVE',
      creditLimit: 500000,
      creditCurrency: 'ARS',
      paymentTerms: 30,
      discount: 5,
      priceMultiplier: 1.2,
      balance: 0,
      salesPersonId: user?.id,
      notes: 'Cliente de prueba creado automáticamente para verificar el sistema.',
    }

    console.log('📋 Datos del cliente:')
    console.log(`   Nombre: ${customerData.name}`)
    console.log(`   Razón Social: ${customerData.businessName}`)
    console.log(`   CUIT: ${customerData.cuit}`)
    console.log(`   Email: ${customerData.email}`)
    console.log(`   Vendedor: ${user?.name || 'Sin asignar'}`)
    console.log(`   Multiplicador: ${customerData.priceMultiplier}x`)
    console.log(`   Límite Crédito: $${customerData.creditLimit.toLocaleString('es-AR')}`)
    console.log(`   Plazo: ${customerData.paymentTerms} días\n`)

    // Verificar si ya existe un cliente con ese CUIT
    const existing = await prisma.customer.findUnique({
      where: { cuit: customerData.cuit },
    })

    if (existing) {
      console.log('⚠️  Ya existe un cliente con ese CUIT')
      console.log(`   ID: ${existing.id}`)
      console.log(`   Nombre: ${existing.name}`)
      console.log(`   Puedes verlo en: http://localhost:3000/clientes/${existing.id}\n`)
      return
    }

    // Crear cliente
    console.log('💾 Creando cliente en la base de datos...')
    const customer = await prisma.customer.create({
      data: customerData,
      include: {
        salesPerson: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    })

    console.log('\n✅ ¡Cliente creado exitosamente!\n')
    console.log('📊 Resultado:')
    console.log(`   ID: ${customer.id}`)
    console.log(`   Nombre: ${customer.name}`)
    console.log(`   CUIT: ${customer.cuit}`)
    console.log(`   Balance: $${Number(customer.balance).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`)
    console.log(`   Multiplicador: ${Number(customer.priceMultiplier)}x`)
    console.log(`   Estado: ${customer.status}`)
    console.log(`   Vendedor: ${customer.salesPerson?.name || 'Sin asignar'}`)
    console.log(`\n🌐 Ver en el navegador:`)
    console.log(`   http://localhost:3000/clientes/${customer.id}`)
    console.log(`\n📋 Listado de clientes:`)
    console.log(`   http://localhost:3000/clientes\n`)

    // Registrar actividad
    if (user) {
      await prisma.activity.create({
        data: {
          type: 'CUSTOMER_CREATED',
          userId: user.id,
          entityType: 'customer',
          entityId: customer.id,
          customerId: customer.id,
          title: `Cliente creado: ${customer.name}`,
          description: `Se creó el cliente ${customer.name} (${customer.cuit}) desde script de prueba`,
        },
      })
      console.log('✅ Actividad registrada\n')
    }

    // Estadísticas
    const totalCustomers = await prisma.customer.count()
    const activeCustomers = await prisma.customer.count({
      where: { status: 'ACTIVE' },
    })

    console.log('📈 Estadísticas:')
    console.log(`   Total clientes: ${totalCustomers}`)
    console.log(`   Clientes activos: ${activeCustomers}`)
    console.log(`   Clientes inactivos: ${totalCustomers - activeCustomers}\n`)

  } catch (error) {
    console.error('\n❌ Error al crear cliente:', error)
    if (error instanceof Error) {
      console.error(`   Mensaje: ${error.message}\n`)
    }
    process.exit(1)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

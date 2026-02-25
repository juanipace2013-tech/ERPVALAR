import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  try {
    const customer = await prisma.customer.create({
      data: {
        name: 'Juan Pérez',
        businessName: 'Juan Pérez',
        type: 'INDIVIDUAL',
        cuit: '20-12345678-9',
        taxCondition: 'MONOTRIBUTO',
        email: 'juan.perez@email.com',
        phone: '011-4888-6666',
        mobile: '011-15-8888-1111',
        address: 'Calle Falsa 123',
        city: 'Rosario',
        province: 'Santa Fe',
        postalCode: 'S2000',
        country: 'Argentina',
        status: 'ACTIVE',
        creditLimit: 50000,
        creditCurrency: 'ARS',
        paymentTerms: 15,
        discount: 0,
        priceMultiplier: 1.0,
        notes: 'Cliente individual - pago contado',
      },
    })
    console.log('✅ Juan Pérez importado exitosamente')
    console.log(`   ID: ${customer.id}`)
    console.log(`   CUIT: ${customer.cuit}`)
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : 'Error desconocido')
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

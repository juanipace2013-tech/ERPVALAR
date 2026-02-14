import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🔄 Migrando enums de Customer...')

  try {
    // Actualizar COMPANY a BUSINESS
    const companiesCount = await prisma.$executeRaw`
      UPDATE "customers"
      SET "type" = 'BUSINESS'::text::"CustomerType"
      WHERE "type" = 'COMPANY'::text::"CustomerType"
    `
    console.log(`✅ ${companiesCount} clientes actualizados de COMPANY a BUSINESS`)

    // Actualizar BLOCKED a INACTIVE
    const blockedCount = await prisma.$executeRaw`
      UPDATE "customers"
      SET "status" = 'INACTIVE'::text::"CustomerStatus"
      WHERE "status" = 'BLOCKED'::text::"CustomerStatus"
    `
    console.log(`✅ ${blockedCount} clientes actualizados de BLOCKED a INACTIVE`)

    console.log('\n✅ Migración completada exitosamente!')
  } catch (error) {
    console.error('❌ Error en la migración:', error)
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

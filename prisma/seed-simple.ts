import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const prisma = new PrismaClient()

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_SEED_IN_PRODUCTION) {
    console.error('❌ This script cannot run in production. Set ALLOW_SEED_IN_PRODUCTION=1 to override.')
    process.exit(1)
  }

  console.log('🌱 Starting simple seed...')

  // ========================================
  // USUARIOS
  // ========================================
  console.log('Creating users...')

  const adminPassword = crypto.randomBytes(16).toString('base64url')
  const vendedorPassword = crypto.randomBytes(16).toString('base64url')
  const gerentePassword = crypto.randomBytes(16).toString('base64url')

  console.log(`[SEED] admin@valarg.com password: ${adminPassword}`)
  console.log(`[SEED] vendedor@valarg.com password: ${vendedorPassword}`)
  console.log(`[SEED] gerente@valarg.com password: ${gerentePassword}`)

  const hashedPasswordAdmin = await bcrypt.hash(adminPassword, 12)
  const hashedPasswordVendedor = await bcrypt.hash(vendedorPassword, 12)
  const hashedPasswordGerente = await bcrypt.hash(gerentePassword, 12)

  // Verificar y crear admin
  const existingAdmin = await prisma.user.findUnique({
    where: { email: 'admin@valarg.com' },
  })

  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        name: 'Administrador',
        email: 'admin@valarg.com',
        password: hashedPasswordAdmin,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    })
    console.log('✓ Created admin user')
  } else {
    // Actualizar contraseña si ya existe
    await prisma.user.update({
      where: { email: 'admin@valarg.com' },
      data: { password: hashedPasswordAdmin },
    })
    console.log('✓ Updated admin password')
  }

  // Verificar y crear vendedor
  const existingVendedor = await prisma.user.findUnique({
    where: { email: 'vendedor@valarg.com' },
  })

  if (!existingVendedor) {
    await prisma.user.create({
      data: {
        name: 'Juan Vendedor',
        email: 'vendedor@valarg.com',
        password: hashedPasswordVendedor,
        role: 'VENDEDOR',
        status: 'ACTIVE',
        phone: '+54 11 1234-5678',
      },
    })
    console.log('✓ Created vendedor user')
  } else {
    await prisma.user.update({
      where: { email: 'vendedor@valarg.com' },
      data: { password: hashedPasswordVendedor },
    })
    console.log('✓ Updated vendedor password')
  }

  // Verificar y crear gerente
  const existingGerente = await prisma.user.findUnique({
    where: { email: 'gerente@valarg.com' },
  })

  if (!existingGerente) {
    await prisma.user.create({
      data: {
        name: 'María Gerente',
        email: 'gerente@valarg.com',
        password: hashedPasswordGerente,
        role: 'GERENTE',
        status: 'ACTIVE',
        phone: '+54 11 8765-4321',
      },
    })
    console.log('✓ Created gerente user')
  } else {
    await prisma.user.update({
      where: { email: 'gerente@valarg.com' },
      data: { password: hashedPasswordGerente },
    })
    console.log('✓ Updated gerente password')
  }

  // ========================================
  // RESUMEN
  // ========================================
  console.log('\n✅ Seed completed successfully!')

  console.log('\n⚠️  IMPORTANT: Save the passwords above. They will not be shown again.\n')
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

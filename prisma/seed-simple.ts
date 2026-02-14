import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting simple seed...')

  // ========================================
  // USUARIOS
  // ========================================
  console.log('Creating users...')

  const hashedPasswordAdmin = await bcrypt.hash('admin123', 10)
  const hashedPasswordVendedor = await bcrypt.hash('vendedor123', 10)
  const hashedPasswordGerente = await bcrypt.hash('gerente123', 10)

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
  console.log('\n📊 Test users:')
  console.log(`   - admin@valarg.com / admin123 (ADMIN)`)
  console.log(`   - vendedor@valarg.com / vendedor123 (VENDEDOR)`)
  console.log(`   - gerente@valarg.com / gerente123 (GERENTE)`)
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

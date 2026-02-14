import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🔍 Verificando usuarios en el sistema...\n')

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
    },
  })

  if (users.length === 0) {
    console.log('❌ No hay usuarios en el sistema\n')
    console.log('📝 Para crear un usuario de prueba, ejecuta:')
    console.log('   npx ts-node scripts/create-test-user.ts\n')
    return
  }

  console.log(`✅ Encontrados ${users.length} usuario(s):\n`)
  users.forEach((user, index) => {
    console.log(`${index + 1}. ${user.name}`)
    console.log(`   Email: ${user.email}`)
    console.log(`   Role: ${user.role}`)
    console.log(`   Status: ${user.status}`)
    console.log()
  })

  console.log('💡 Para iniciar sesión:')
  console.log('   1. Abre http://localhost:3000/login')
  console.log('   2. Usa las credenciales de alguno de estos usuarios')
  console.log('   3. La contraseña es la que configuraste al crear el usuario\n')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

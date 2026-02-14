import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const email = process.argv[2] || 'admin@valarg.com'
  const newPassword = process.argv[3] || 'admin123'

  console.log(`🔐 Reseteando contraseña para: ${email}\n`)

  const user = await prisma.user.findUnique({
    where: { email },
  })

  if (!user) {
    console.log(`❌ Usuario no encontrado: ${email}\n`)
    process.exit(1)
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10)

  await prisma.user.update({
    where: { email },
    data: { password: hashedPassword },
  })

  console.log(`✅ Contraseña actualizada exitosamente!\n`)
  console.log(`📧 Email: ${email}`)
  console.log(`🔑 Nueva contraseña: ${newPassword}\n`)
  console.log(`🌐 Iniciar sesión en: http://localhost:3000/login\n`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

import { PrismaClient } from '@prisma/client'
import { PLAN_CUENTAS_ARGENTINA } from '../src/lib/contabilidad/plan-cuentas-argentina'
import { getParentCode } from '../src/lib/contabilidad/validations'

const prisma = new PrismaClient()

async function seedChartOfAccounts() {
  console.log('🌱 Iniciando seed del Plan de Cuentas...')

  // Verificar si ya existen cuentas
  const existingCount = await prisma.chartOfAccount.count()
  if (existingCount > 0) {
    console.log(`⚠️  Ya existen ${existingCount} cuentas en el sistema`)
    console.log('   Si deseas recrear el plan de cuentas, elimina las cuentas existentes primero')
    return
  }

  // Crear cuentas nivel por nivel para mantener la jerarquía
  const accountsByLevel = PLAN_CUENTAS_ARGENTINA.reduce((acc, account) => {
    if (!acc[account.level]) acc[account.level] = []
    acc[account.level].push(account)
    return acc
  }, {} as Record<number, typeof PLAN_CUENTAS_ARGENTINA>)

  const createdAccounts = new Map<string, string>() // Map de code -> id

  // Procesar nivel por nivel
  for (let level = 1; level <= 4; level++) {
    const accounts = accountsByLevel[level] || []

    if (accounts.length === 0) continue

    console.log(`📊 Creando ${accounts.length} cuentas de nivel ${level}...`)

    for (const account of accounts) {
      try {
        // Buscar el parent ID si es nivel > 1
        let parentId: string | null = null

        if (level > 1) {
          const parentCode = getParentCode(account.code)
          if (parentCode) {
            parentId = createdAccounts.get(parentCode) || null
          }
        }

        const created = await prisma.chartOfAccount.create({
          data: {
            code: account.code,
            name: account.name,
            accountType: account.accountType,
            level: account.level,
            acceptsEntries: account.acceptsEntries,
            parentId,
            isActive: true,
          },
        })

        createdAccounts.set(account.code, created.id)
      } catch (error) {
        console.error(`❌ Error creando cuenta ${account.code} - ${account.name}:`, error)
      }
    }
  }

  const totalCreated = createdAccounts.size
  console.log(`\n✅ Plan de Cuentas creado exitosamente!`)
  console.log(`   Total de cuentas creadas: ${totalCreated}`)

  // Resumen por tipo
  const summary = await prisma.chartOfAccount.groupBy({
    by: ['accountType'],
    _count: true,
  })

  console.log('\n📊 Resumen por tipo de cuenta:')
  summary.forEach(item => {
    console.log(`   ${item.accountType}: ${item._count} cuentas`)
  })
}

async function main() {
  try {
    await seedChartOfAccounts()
  } catch (error) {
    console.error('❌ Error durante el seed:', error)
    throw error
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const customers = await prisma.customer.findMany({
    select: { id: true, name: true, cuit: true, createdAt: true, salesPersonId: true },
    orderBy: { cuit: 'asc' }
  })

  // Agrupar por CUIT normalizado (sin guiones ni espacios)
  const byCuit = new Map<string, typeof customers>()
  for (const c of customers) {
    const normalized = (c.cuit || '').replace(/\D/g, '')
    if (!normalized) continue
    if (!byCuit.has(normalized)) byCuit.set(normalized, [])
    byCuit.get(normalized)!.push(c)
  }

  // Mostrar duplicados
  let count = 0
  for (const [cuit, group] of byCuit) {
    if (group.length > 1) {
      count++
      console.log(`\nDUPLICADO: CUIT ${group[0].cuit} (${group.length} registros)`)
      for (const c of group) {
        console.log(`  - ID: ${c.id} | Name: ${c.name} | Created: ${c.createdAt.toISOString().split('T')[0]} | SalesPerson: ${c.salesPersonId || 'ninguno'}`)
      }
    }
  }
  console.log(`\nTotal: ${count} CUITs duplicados`)
}

main().finally(() => prisma.$disconnect())

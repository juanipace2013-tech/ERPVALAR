import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      sku: true,
      name: true,
      type: true,
      stockQuantity: true,
      averageCost: true,
      lastCost: true,
      trackInventory: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  console.log(`\n📦 Total de productos: ${products.length}\n`)

  products.forEach((p, index) => {
    console.log(`${index + 1}. ${p.name}`)
    console.log(`   ID: ${p.id}`)
    console.log(`   SKU: ${p.sku}`)
    console.log(`   Tipo: ${p.type}`)
    console.log(`   Stock: ${p.stockQuantity}`)
    console.log(`   Costo Promedio: ${p.averageCost || 'N/A'}`)
    console.log(`   Último Costo: ${p.lastCost || 'N/A'}`)
    console.log(`   Trackea Inventario: ${p.trackInventory}`)
    console.log('')
  })
}

main()
  .catch((e) => {
    console.error('Error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

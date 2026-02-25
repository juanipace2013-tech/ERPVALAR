import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const suppliers = await prisma.supplier.findMany({
    select: {
      name: true,
      brands: true,
      discount: true,
      isPreferred: true,
      status: true,
    },
  })

  console.log('\n📦 Proveedores en la base de datos:\n')

  suppliers.forEach((sup, i) => {
    const star = sup.isPreferred ? '⭐' : '  '
    console.log(`${i + 1}. ${star} ${sup.name}`)
    console.log(`   Marcas: [${sup.brands.join(', ')}]`)
    console.log(`   Descuento: ${sup.discount}%`)
    console.log(`   Estado: ${sup.status}`)
    console.log('')
  })

  console.log(`✅ Total: ${suppliers.length} proveedores\n`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })

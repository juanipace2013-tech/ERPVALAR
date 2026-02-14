import { PrismaClient, StockMovementType, Currency } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('📦 Iniciando seed de movimientos de stock...')

  // Obtener primer usuario (admin)
  const user = await prisma.user.findFirst()
  if (!user) {
    throw new Error('No hay usuarios en la base de datos')
  }

  // Obtener productos
  const productos = await prisma.product.findMany({
    where: {
      type: 'PRODUCT', // Solo productos físicos
    },
    take: 3,
  })

  if (productos.length === 0) {
    console.log('❌ No hay productos para crear movimientos')
    return
  }

  console.log(`📊 Creando movimientos para ${productos.length} productos...`)

  for (const producto of productos) {
    // Movimiento de compra inicial (entrada)
    await prisma.stockMovement.create({
      data: {
        productId: producto.id,
        userId: user.id,
        type: StockMovementType.COMPRA,
        quantity: producto.stockQuantity, // Cantidad actual como compra inicial
        unitCost: Number(producto.lastCost || 0),
        totalCost: Number(producto.lastCost || 0) * producto.stockQuantity,
        currency: Currency.ARS,
        stockBefore: 0,
        stockAfter: producto.stockQuantity,
        reference: 'COMP-001',
        notes: 'Compra inicial de inventario',
        date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Hace 30 días
      },
    })

    console.log(`✅ Movimiento de compra creado para: ${producto.name}`)

    // Movimiento de ajuste (si tiene stock suficiente)
    if (producto.stockQuantity >= 5) {
      const stockActual = producto.stockQuantity
      const ajuste = 5

      await prisma.stockMovement.create({
        data: {
          productId: producto.id,
          userId: user.id,
          type: StockMovementType.AJUSTE_POSITIVO,
          quantity: ajuste,
          unitCost: Number(producto.lastCost || 0),
          totalCost: Number(producto.lastCost || 0) * ajuste,
          currency: Currency.ARS,
          stockBefore: stockActual,
          stockAfter: stockActual + ajuste,
          reference: 'AJU-001',
          notes: 'Ajuste por inventario físico',
          date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // Hace 15 días
        },
      })

      console.log(`✅ Movimiento de ajuste creado para: ${producto.name}`)
    }

    // Simular una venta (salida)
    if (producto.stockQuantity >= 3) {
      const stockActual = producto.stockQuantity
      const venta = 3

      await prisma.stockMovement.create({
        data: {
          productId: producto.id,
          userId: user.id,
          type: StockMovementType.VENTA,
          quantity: -venta, // Negativo para salida
          unitCost: Number(producto.lastCost || 0),
          totalCost: Number(producto.lastCost || 0) * venta,
          currency: Currency.ARS,
          stockBefore: stockActual,
          stockAfter: stockActual - venta,
          reference: 'FAC-001',
          notes: 'Venta a cliente - Factura #001',
          date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Hace 7 días
        },
      })

      console.log(`✅ Movimiento de venta creado para: ${producto.name}`)
    }
  }

  console.log('\n✨ Seed de movimientos completado exitosamente!')
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

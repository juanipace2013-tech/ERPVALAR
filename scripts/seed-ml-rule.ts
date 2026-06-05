/**
 * Crea (o actualiza) la MlMessageRule para la Válvula Reductora Redux 3318-05.
 *
 * Esta válvula viene con manómetro y hay que preguntarle al comprador qué rango
 * de presión necesita. La regla deja el mensaje en modo REVIEW: cuando entra la
 * venta, el sistema arma el mensaje y queda pendiente para enviarlo con un click.
 *
 * Idempotente: se puede correr las veces que haga falta.
 *   npx tsx scripts/seed-ml-rule.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const REDUX_SELLER_SKU = '3318 05 + 3821'
const REDUX_MESSAGE_TEXT =
  'Hola, gracias por tu compra. La reductora viene con manómetro; decime qué ' +
  'rango necesitás: 0-2,5 / 0-4 / 0-6 / 0-10 / 0-16 / 0-25 BAR. Respondé este ' +
  'mensaje y lo preparo. ¡Gracias!'

async function main() {
  if (REDUX_MESSAGE_TEXT.length > 350) {
    throw new Error(`message_text supera 350 chars (${REDUX_MESSAGE_TEXT.length})`)
  }

  const existing = await prisma.mlMessageRule.findFirst({
    where: { sellerSku: REDUX_SELLER_SKU },
  })

  if (existing) {
    const updated = await prisma.mlMessageRule.update({
      where: { id: existing.id },
      data: {
        enabled: true,
        messageText: REDUX_MESSAGE_TEXT,
        mode: 'REVIEW',
      },
    })
    console.log(`✓ Regla actualizada (id=${updated.id}, sku="${REDUX_SELLER_SKU}")`)
  } else {
    const created = await prisma.mlMessageRule.create({
      data: {
        enabled: true,
        sellerSku: REDUX_SELLER_SKU,
        messageText: REDUX_MESSAGE_TEXT,
        mode: 'REVIEW',
      },
    })
    console.log(`✓ Regla creada (id=${created.id}, sku="${REDUX_SELLER_SKU}")`)
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('❌ Error en seed-ml-rule:', e)
    await prisma.$disconnect()
    process.exit(1)
  })

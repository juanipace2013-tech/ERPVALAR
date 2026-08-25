/**
 * Crea (o actualiza) las MlMessageRule de las válvulas reductoras con
 * manómetro. Cuando entra una venta paga de estas publicaciones, el webhook
 * de órdenes manda solo el mensaje pidiendo el rango del manómetro (modo AUTO).
 *
 * Publicaciones (99% del tráfico según Santiago, 2026-08-25):
 *   - MLA2047850328: Válvula Reductora Reguladora Presión 3/4"
 *   - MLA1141588199: Válvula Reductora Reguladora Presión 1/2"
 *
 * Idempotente: se puede correr las veces que haga falta.
 *   npx tsx scripts/seed-ml-rule.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const MESSAGE_TEXT = `Buen dia.

📊 SELECCIÓN DEL RANGO DEL MANÓMETRO

A continuación, se detallan los rangos disponibles: 0-2,5 / 0-4 / 0-6 / 0-10 / 0-16 / 0-25 BAR.

Importante ‼️ Necesitamos recibir su respuesta antes de las 12:00 hs. De lo contrario, el paquete se armará con un manómetro de 0-6 BAR o 0-10 BAR, según disponibilidad.`

const RULES = [
  { mlItemId: 'MLA2047850328', nota: 'reductora 3/4"' },
  { mlItemId: 'MLA1141588199', nota: 'reductora 1/2"' },
]

async function main() {
  if (MESSAGE_TEXT.length > 350) {
    throw new Error(`message_text supera 350 chars (${MESSAGE_TEXT.length})`)
  }

  for (const r of RULES) {
    const existing = await prisma.mlMessageRule.findFirst({
      where: { mlItemId: r.mlItemId },
    })

    if (existing) {
      const updated = await prisma.mlMessageRule.update({
        where: { id: existing.id },
        data: { enabled: true, messageText: MESSAGE_TEXT, mode: 'AUTO' },
      })
      console.log(`✓ Regla actualizada (id=${updated.id}, item=${r.mlItemId}, ${r.nota})`)
    } else {
      const created = await prisma.mlMessageRule.create({
        data: {
          enabled: true,
          mlItemId: r.mlItemId,
          messageText: MESSAGE_TEXT,
          mode: 'AUTO',
        },
      })
      console.log(`✓ Regla creada (id=${created.id}, item=${r.mlItemId}, ${r.nota})`)
    }
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

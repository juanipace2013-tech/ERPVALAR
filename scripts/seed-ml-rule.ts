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

// {{nombre}} se reemplaza por el primer nombre del comprador al enviar (y se
// omite si la orden no lo trae). Formato original con emojis a pedido de
// Santiago (2026-08-25): el filtro automatic_message de ML rechaza CUALQUIER
// texto libre inicial por API (es por origen, no por contenido), así que este
// texto en la práctica viaja como AUTO-REPLY cuando el comprador responde al
// template REQUEST_VARIANTS — y en conversación abierta la moderación pasa.
const MESSAGE_TEXT = `Buen dia {{nombre}}.

📊 SELECCIÓN DEL RANGO DEL MANÓMETRO

A continuación, se detallan los rangos disponibles: 0-2,5 / 0-4 / 0-6 / 0-10 / 0-16 / 0-25 BAR.

Importante ‼️ Necesitamos recibir su respuesta antes de las 12:00 hs. De lo contrario, el paquete se armará con un manómetro de 0-6 BAR o 0-10 BAR, según disponibilidad.`

const RULES = [
  { mlItemId: 'MLA2047850328', nota: 'reductora 3/4"' },
  { mlItemId: 'MLA1141588199', nota: 'reductora 1/2"' },
]

async function main() {
  // Validar el largo con un nombre largo de ejemplo (el límite de ML es 350).
  const rendered = MESSAGE_TEXT.replace(/\{\{\s*nombre\s*\}\}/g, 'Maximiliano')
  if (rendered.length > 350) {
    throw new Error(`message_text renderizado supera 350 chars (${rendered.length})`)
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

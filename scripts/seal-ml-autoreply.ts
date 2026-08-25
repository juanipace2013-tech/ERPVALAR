/**
 * Sella el auto-reply de un pack post-venta: marca autoReplyStatus = SENT para
 * que handleBuyerReply NO le mande el texto de rangos cuando el comprador
 * vuelva a escribir (porque el reply ya se le envió por otra vía).
 *
 * Caso que lo motiva: el pack 2000014703785113 (venta Fernando Sensi,
 * 2026-08-25, la que validó el diseño del auto-reply) recibió el detalle de
 * rangos a mano por script ANTES de activar el auto-reply. Sin sellarlo, su
 * próximo mensaje dispararía un re-envío.
 *
 * Correr en el VPS después del `prisma db push` que crea los campos autoReply*:
 *   npx tsx scripts/seal-ml-autoreply.ts 2000014703785113
 *
 * Idempotente: solo actúa si autoReplyStatus está en null.
 */

import { PrismaClient, MlAutoReplyStatus } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const packId = process.argv[2]
  if (!packId) {
    console.error('Uso: npx tsx scripts/seal-ml-autoreply.ts <packId>')
    process.exit(1)
  }

  const record = await prisma.mlPostSaleMessage.findUnique({ where: { packId } })
  if (!record) {
    console.error(`No hay MlPostSaleMessage para pack=${packId}`)
    process.exit(1)
  }

  if (record.autoReplyStatus !== null) {
    console.log(
      `pack=${packId} ya tiene autoReplyStatus=${record.autoReplyStatus}, nada que hacer`
    )
    return
  }

  await prisma.mlPostSaleMessage.update({
    where: { id: record.id },
    data: {
      autoReplyStatus: MlAutoReplyStatus.SENT,
      autoReplyAt: new Date(),
      autoReplyError: 'Sellado manual: reply enviado por fuera del auto-reply',
    },
  })
  console.log(`pack=${packId} sellado: autoReplyStatus=SENT (no se le re-enviará)`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

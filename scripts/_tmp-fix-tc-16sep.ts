/**
 * Fix puntual 17/9/2026: el TC del 16/9 quedó en 1530 (carga manual de ayer,
 * hecha antes de la automatización, con la convención vieja "fecha de hoy,
 * valor de ayer"). El billete venta BNA del 16/9 fue 1535 → corregir la fila
 * para que hoy se facture con el valor correcto.
 */
import { prisma } from '@/lib/prisma'

async function main() {
  const id = 'cmu40801901aod7x4kwu38jvh'
  const antes = await prisma.exchangeRate.findUnique({ where: { id } })
  if (!antes) throw new Error('No existe la fila ' + id)
  console.log('ANTES:', antes.validFrom.toISOString(), String(antes.rate), antes.source)

  if (antes.validFrom.toISOString() !== '2026-09-16T00:00:00.000Z') {
    throw new Error('validFrom inesperado, no toco nada')
  }

  const despues = await prisma.exchangeRate.update({
    where: { id },
    data: { rate: 1535, source: 'BNA' },
  })
  console.log('DESPUES:', despues.validFrom.toISOString(), String(despues.rate), despues.source)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })

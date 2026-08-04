/**
 * Reemplaza la escala de comisiones por la nueva (vigente desde Agosto 2026):
 *
 *   Menos de $20.000        → 1,25%
 *   $20.000 - $40.000       → 1,50%
 *   $40.000 - $60.000       → 1,75%
 *   Más de $60.000          → 2,00%
 *
 * OJO: getEscala() no versiona por fecha — cualquier liquidación que se
 * refresque o reabra después de correr esto (incluida Julio 2026) usa la
 * escala nueva. Julio ya liquidado no se recalcula solo.
 *
 * Uso (en el VPS):
 *   npx tsx scripts/actualizar-escala-comisiones.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const ESCALA_NUEVA = [
  { pisoUsd: 0, techoUsd: 20000, tasa: 0.0125 },
  { pisoUsd: 20000, techoUsd: 40000, tasa: 0.015 },
  { pisoUsd: 40000, techoUsd: 60000, tasa: 0.0175 },
  { pisoUsd: 60000, techoUsd: null, tasa: 0.02 },
]

function fmt(t: { pisoUsd: unknown; techoUsd: unknown; tasa: unknown }) {
  const techo = t.techoUsd === null ? 'sin techo' : Number(t.techoUsd).toLocaleString('es-AR')
  return `  ${Number(t.pisoUsd).toLocaleString('es-AR')} → ${techo}: ${(Number(t.tasa) * 100).toFixed(2)}%`
}

async function main() {
  const actual = await prisma.comisionEscala.findMany({ orderBy: { pisoUsd: 'asc' } })
  console.log(`Escala actual (${actual.length} tramos):`)
  actual.forEach((t) => console.log(fmt(t)))

  await prisma.$transaction([
    prisma.comisionEscala.deleteMany(),
    prisma.comisionEscala.createMany({ data: ESCALA_NUEVA }),
  ])

  const nueva = await prisma.comisionEscala.findMany({ orderBy: { pisoUsd: 'asc' } })
  console.log(`\nEscala nueva (${nueva.length} tramos):`)
  nueva.forEach((t) => console.log(fmt(t)))
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

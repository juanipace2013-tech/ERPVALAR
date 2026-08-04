/**
 * Carga la escala de comisiones nueva, vigente desde Agosto 2026:
 *
 *   Menos de $20.000        → 1,25%
 *   $20.000 - $40.000       → 1,50%
 *   $40.000 - $60.000       → 1,75%
 *   Más de $60.000          → 2,00%
 *
 * No borra la escala vieja: le normaliza vigenteDesde a 2026-07-01 y agrega
 * los tramos nuevos con vigenteDesde 2026-08-01. getEscala(anio, mes) elige
 * el set según el mes, así Julio 2026 (todavía ABIERTA) se sigue refrescando
 * con la escala vieja y Agosto en adelante usa la nueva.
 *
 * Idempotente. Uso (en el VPS):
 *   npx tsx scripts/actualizar-escala-comisiones.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const VIEJA_DESDE = new Date(Date.UTC(2026, 6, 1)) // 2026-07-01
const NUEVA_DESDE = new Date(Date.UTC(2026, 7, 1)) // 2026-08-01

const ESCALA_NUEVA = [
  { pisoUsd: 0, techoUsd: 20000, tasa: 0.0125, vigenteDesde: NUEVA_DESDE },
  { pisoUsd: 20000, techoUsd: 40000, tasa: 0.015, vigenteDesde: NUEVA_DESDE },
  { pisoUsd: 40000, techoUsd: 60000, tasa: 0.0175, vigenteDesde: NUEVA_DESDE },
  { pisoUsd: 60000, techoUsd: null, tasa: 0.02, vigenteDesde: NUEVA_DESDE },
]

function fmt(t: { pisoUsd: unknown; techoUsd: unknown; tasa: unknown }) {
  const techo = t.techoUsd === null ? 'sin techo' : Number(t.techoUsd).toLocaleString('es-AR')
  return `  ${Number(t.pisoUsd).toLocaleString('es-AR')} → ${techo}: ${(Number(t.tasa) * 100).toFixed(2)}%`
}

async function main() {
  const yaCargada = await prisma.comisionEscala.count({
    where: { vigenteDesde: { gte: NUEVA_DESDE } },
  })
  if (yaCargada > 0) {
    console.log(`Escala nueva ya cargada (${yaCargada} tramos), no se toca`)
  } else {
    await prisma.$transaction([
      prisma.comisionEscala.updateMany({
        where: { vigenteDesde: { lt: NUEVA_DESDE } },
        data: { vigenteDesde: VIEJA_DESDE },
      }),
      prisma.comisionEscala.createMany({ data: ESCALA_NUEVA }),
    ])
    console.log('Escala nueva cargada')
  }

  const tramos = await prisma.comisionEscala.findMany({
    orderBy: [{ vigenteDesde: 'asc' }, { pisoUsd: 'asc' }],
  })
  for (const t of tramos) {
    console.log(`vigente desde ${t.vigenteDesde.toISOString().slice(0, 10)}:`)
    console.log(fmt(t))
  }
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

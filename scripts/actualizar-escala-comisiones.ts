/**
 * Reemplaza la escala de comisiones por la nueva, vigente desde Julio 2026
 * (decisión 2026-08-04: aplica también retroactivo a Julio, que sigue ABIERTA):
 *
 *   Menos de $20.000        → 1,25%
 *   $20.000 - $40.000       → 1,50%
 *   $40.000 - $60.000       → 1,75%
 *   Más de $60.000          → 2,00%
 *
 * Borra la escala vieja (no hay meses liquidados anteriores a Julio en el ERP),
 * carga la nueva con vigenteDesde 2026-07-01 y recalcula todas las
 * liquidaciones ABIERTAS para que tomen el tramo nuevo.
 *
 * Idempotente. Uso (en el VPS):
 *   npx tsx scripts/actualizar-escala-comisiones.ts
 */
import { PrismaClient } from '@prisma/client'
import { recalcular } from '@/lib/comisiones/liquidacion'

const prisma = new PrismaClient()

const NUEVA_DESDE = new Date(Date.UTC(2026, 6, 1)) // 2026-07-01

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
  const total = await prisma.comisionEscala.count()
  const nuevaYa = await prisma.comisionEscala.count({ where: { vigenteDesde: NUEVA_DESDE } })
  if (total === ESCALA_NUEVA.length && nuevaYa === ESCALA_NUEVA.length) {
    console.log('Escala nueva ya cargada, no se toca la tabla')
  } else {
    await prisma.$transaction([
      prisma.comisionEscala.deleteMany(),
      prisma.comisionEscala.createMany({ data: ESCALA_NUEVA }),
    ])
    console.log('Escala nueva cargada (vigente desde 2026-07-01):')
    const tramos = await prisma.comisionEscala.findMany({ orderBy: { pisoUsd: 'asc' } })
    tramos.forEach((t) => console.log(fmt(t)))
  }

  const abiertas = await prisma.comisionLiquidacion.findMany({
    where: { estado: 'ABIERTA' },
    include: { vendedor: { select: { name: true } } },
    orderBy: [{ anio: 'asc' }, { mes: 'asc' }],
  })
  console.log(`\nRecalculando ${abiertas.length} liquidaciones ABIERTAS:`)
  for (const liq of abiertas) {
    const antes = liq.tasaMes === null ? '—' : `${(Number(liq.tasaMes) * 100).toFixed(2)}%`
    const despues = await recalcular(liq.id)
    const tasa = despues.tasaMes === null ? '—' : `${(Number(despues.tasaMes) * 100).toFixed(2)}%`
    console.log(
      `  ${liq.anio}-${String(liq.mes).padStart(2, '0')} ${liq.vendedor.name}: ` +
        `USD ${Number(despues.totalFacturadoUsd).toLocaleString('es-AR')} | tasa ${antes} → ${tasa} | ` +
        `comisiones ARS ${Number(despues.comisionesArs).toLocaleString('es-AR')}`
    )
  }
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

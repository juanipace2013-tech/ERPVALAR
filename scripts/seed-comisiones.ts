/**
 * Seed del módulo Comisiones:
 *   - Escala constante (corrige el bug de la planilla: el tramo >100k
 *     apuntaba a una celda vacía).
 *   - Config de Germán Acevedo: básico mensual ARS 1.500.000.
 *
 * Idempotente. Uso:
 *   npx tsx scripts/seed-comisiones.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const ESCALA = [
  { pisoUsd: 0, techoUsd: 50000, tasa: 0.01 },
  { pisoUsd: 50000, techoUsd: 75000, tasa: 0.0125 },
  { pisoUsd: 75000, techoUsd: 100000, tasa: 0.015 },
  { pisoUsd: 100000, techoUsd: null, tasa: 0.02 },
]

const GERMAN_EMAIL = 'gacevedo@val-ar.com.ar'
const GERMAN_BASICO_ARS = 1_500_000

async function main() {
  const existentes = await prisma.comisionEscala.count()
  if (existentes === 0) {
    await prisma.comisionEscala.createMany({ data: ESCALA })
    console.log(`Escala creada (${ESCALA.length} tramos)`)
  } else {
    console.log(`Escala ya cargada (${existentes} tramos), no se toca`)
  }

  const german = await prisma.user.findUnique({ where: { email: GERMAN_EMAIL } })
  if (!german) {
    throw new Error(`No existe el usuario ${GERMAN_EMAIL} en la DB`)
  }

  const config = await prisma.vendedorComisionConfig.upsert({
    where: { vendedorId: german.id },
    create: { vendedorId: german.id, basicoArs: GERMAN_BASICO_ARS },
    update: {}, // si ya existe no pisamos un básico editado a mano
  })
  console.log(`Config de ${german.name}: básico ARS ${Number(config.basicoArs).toLocaleString('es-AR')}`)
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

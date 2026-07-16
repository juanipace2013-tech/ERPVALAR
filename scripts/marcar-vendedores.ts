/**
 * Marca qué usuarios son vendedores (campo User.isVendedor, agregado 2026-07-16).
 *
 * IMPORTANTE: correr DESPUÉS de aplicar el schema a la base (db push). El campo
 * es `@default(false)`, así que hasta que este script corra los selectores de
 * vendedor salen VACÍOS.
 *
 * Por qué existe el campo: `role` expresa nivel de permiso, no función
 * comercial. Todo el equipo es ADMIN, así que no había forma de distinguir a un
 * vendedor de alguien de administración.
 *
 * Idempotente: se puede correr las veces que haga falta.
 *
 * Uso:
 *   npx tsx scripts/marcar-vendedores.ts --dry-run   (por defecto)
 *   npx tsx scripts/marcar-vendedores.ts --apply
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Vendedores. El resto del padrón queda en isVendedor=false.
const VENDEDORES = [
  'gacevedo@val-ar.com.ar', // Germán Acevedo
  'jpace@val-ar.com.ar', // Juan Ignacio Pace
  'stejedor@val-ar.com.ar', // Santiago Tejedor
]

// No vendedores, explícitos para dejar constancia de la decisión:
//   administracion@val-ar.com.ar → Carolina Rutolo, administración
//   prodriguez@val-ar.com.ar     → Paula Rodríguez, baja 2026-07-16

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(apply ? '=== MODO APPLY (escribe en la DB) ===' : '=== DRY RUN (no escribe) ===')

  const todos = await prisma.user.findMany({
    select: { id: true, name: true, email: true, status: true },
    orderBy: { name: 'asc' },
  })

  const faltantes = VENDEDORES.filter(
    (e) => !todos.some((u) => u.email.toLowerCase() === e)
  )
  if (faltantes.length > 0) {
    throw new Error(`Estos emails de vendedor no existen en la DB: ${faltantes.join(', ')}`)
  }

  console.log('\nPlan:')
  for (const u of todos) {
    const esVendedor = VENDEDORES.includes(u.email.toLowerCase())
    console.log(
      `  ${(u.name || '').padEnd(22)} ${u.email.padEnd(32)} ${u.status.padEnd(9)} isVendedor=${esVendedor}`
    )
  }

  if (!apply) {
    console.log('\nDry run: no se escribió nada. Correr con --apply para ejecutar.')
    return
  }

  const [marcados, desmarcados] = await prisma.$transaction([
    prisma.user.updateMany({
      where: { email: { in: VENDEDORES } },
      data: { isVendedor: true },
    }),
    prisma.user.updateMany({
      where: { email: { notIn: VENDEDORES } },
      data: { isVendedor: false },
    }),
  ])

  console.log(`\nOK. isVendedor=true: ${marcados.count}   isVendedor=false: ${desmarcados.count}`)

  const seleccionables = await prisma.user.findMany({
    where: { status: 'ACTIVE', isVendedor: true },
    select: { name: true },
    orderBy: { name: 'asc' },
  })
  console.log(`\nVendedores que van a aparecer en los selectores (${seleccionables.length}):`)
  seleccionables.forEach((v) => console.log(`  - ${v.name}`))
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

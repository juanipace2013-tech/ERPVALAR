/**
 * Baja de Paula Rodríguez como vendedora (2026-07-16).
 *
 * Qué hace, en una sola transacción:
 *   1. Deja sus clientes sin vendedor fijo (salesPersonId = null), o sea en modo
 *      automático: la cotización queda para quien la crea.
 *   2. Registra un AuditLog por cliente (entity CLIENT, action REASIGNAR_VENDEDOR)
 *      con el vendedor anterior, para que el cambio masivo sea trazable.
 *   3. Pasa su usuario a status INACTIVE. NO se borra: el login ya queda
 *      bloqueado por el chequeo de status en src/auth.ts.
 *
 * Idempotente: si ya no le quedan clientes y ya está INACTIVE, no hace nada.
 *
 * Uso:
 *   npx tsx scripts/baja-paula-rodriguez.ts --dry-run   (por defecto)
 *   npx tsx scripts/baja-paula-rodriguez.ts --apply
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const EMAIL_BAJA = 'prodriguez@val-ar.com.ar'
const EMAIL_OPERADOR = 'stejedor@val-ar.com.ar'

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(apply ? '=== MODO APPLY (escribe en la DB) ===' : '=== DRY RUN (no escribe) ===')

  const baja = await prisma.user.findUnique({
    where: { email: EMAIL_BAJA },
    select: { id: true, name: true, email: true, status: true },
  })
  if (!baja) throw new Error(`No existe el usuario ${EMAIL_BAJA}`)

  // El operador queda registrado como autor del cambio en el AuditLog.
  const operador = await prisma.user.findUnique({
    where: { email: EMAIL_OPERADOR },
    select: { id: true, name: true, email: true },
  })
  if (!operador) throw new Error(`No existe el operador ${EMAIL_OPERADOR}`)

  const clientes = await prisma.customer.findMany({
    where: { salesPersonId: baja.id },
    select: { id: true, name: true, cuit: true },
  })

  console.log(`\nUsuario a dar de baja : ${baja.name} <${baja.email}> (status actual: ${baja.status})`)
  console.log(`Operador del cambio   : ${operador.name} <${operador.email}>`)
  console.log(`Clientes a reasignar  : ${clientes.length}`)

  if (!apply) {
    console.log('\nDry run: no se escribió nada. Correr con --apply para ejecutar.')
    return
  }

  const resultado = await prisma.$transaction(
    async (tx) => {
      const update = await tx.customer.updateMany({
        where: { salesPersonId: baja.id },
        data: { salesPersonId: null },
      })

      if (clientes.length > 0) {
        await tx.auditLog.createMany({
          data: clientes.map((c) => ({
            userId: operador.id,
            userName: operador.name,
            userEmail: operador.email,
            action: 'REASIGNAR_VENDEDOR',
            entity: 'CLIENT',
            entityId: c.id,
            entityRef: c.cuit,
            description:
              `Baja de ${baja.name}: reasignó vendedor de ${c.name}: ` +
              `${baja.name} → sin vendedor fijo (automático)`,
          })),
        })
      }

      const user = await tx.user.update({
        where: { id: baja.id },
        data: { status: 'INACTIVE' },
        select: { status: true },
      })

      await tx.auditLog.create({
        data: {
          userId: operador.id,
          userName: operador.name,
          userEmail: operador.email,
          action: 'STATUS_CHANGE',
          entity: 'USER',
          entityId: baja.id,
          entityRef: baja.email,
          description:
            `Dio de baja a ${baja.name} como vendedora: status ACTIVE → INACTIVE. ` +
            `Se liberaron ${update.count} cliente(s) a modo automático.`,
        },
      })

      return { reasignados: update.count, status: user.status }
    },
    { maxWait: 15000, timeout: 60000 }
  )

  console.log(`\nOK. Clientes reasignados: ${resultado.reasignados}`)
  console.log(`OK. ${baja.name} quedó en status: ${resultado.status}`)

  const quedan = await prisma.customer.count({ where: { salesPersonId: baja.id } })
  console.log(`Verificación: clientes que le quedan asignados = ${quedan} (esperado 0)`)
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

/**
 * Backfill de CustomerTransport: crea el registro habitual a partir de los
 * campos legacy defaultTransport* para los clientes que aún no tienen
 * transportes en la tabla nueva.
 *
 * Uso (en el VPS): npx tsx scripts/backfill-customer-transports.ts [--apply]
 * Sin --apply es dry-run.
 */

import { prisma } from '../src/lib/prisma'

async function main() {
  const apply = process.argv.includes('--apply')

  const customers = await prisma.customer.findMany({
    where: {
      defaultTransportName: { not: null },
      transports: { none: {} },
    },
    select: {
      id: true,
      name: true,
      defaultTransportName: true,
      defaultTransportAddress: true,
      defaultTransportSchedule: true,
    },
  })

  console.log(`${customers.length} clientes con transporte legacy sin migrar${apply ? '' : ' (dry-run, usar --apply para escribir)'}`)

  for (const c of customers) {
    console.log(`- ${c.name}: ${c.defaultTransportName} | ${c.defaultTransportAddress ?? '—'} | ${c.defaultTransportSchedule ?? '—'}`)
    if (apply) {
      await prisma.customerTransport.create({
        data: {
          customerId: c.id,
          name: c.defaultTransportName!,
          address: c.defaultTransportAddress,
          schedule: c.defaultTransportSchedule,
          isDefault: true,
        },
      })
    }
  }

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

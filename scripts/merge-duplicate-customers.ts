// scripts/merge-duplicate-customers.ts
//
// Mergea clientes duplicados: mantiene el más viejo (tiene vendedor asignado),
// mueve relaciones del nuevo al viejo, y borra el duplicado.
//
// EJECUTAR EN EL VPS: npx tsx scripts/merge-duplicate-customers.ts
// Primero correr con --dry-run para verificar, luego sin flag para ejecutar.

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  console.log(`\n=== MERGE DUPLICATE CUSTOMERS (${DRY_RUN ? 'DRY RUN' : '⚠️  LIVE MODE'}) ===\n`)

  // 1. Encontrar duplicados agrupando por CUIT normalizado
  const customers = await prisma.customer.findMany({
    select: { id: true, name: true, cuit: true, createdAt: true, salesPersonId: true },
    orderBy: { createdAt: 'asc' },
  })

  const byCuit = new Map<string, typeof customers>()
  for (const c of customers) {
    const normalized = (c.cuit || '').replace(/\D/g, '')
    if (!normalized) continue
    if (!byCuit.has(normalized)) byCuit.set(normalized, [])
    byCuit.get(normalized)!.push(c)
  }

  let mergedCount = 0

  for (const [, group] of byCuit) {
    if (group.length < 2) continue

    // Elegir el "keeper": preferir el que tiene salesPerson, si ambos tienen, el más viejo
    const sorted = [...group].sort((a, b) => {
      // Prioridad 1: tiene salesPerson
      if (a.salesPersonId && !b.salesPersonId) return -1
      if (!a.salesPersonId && b.salesPersonId) return 1
      // Prioridad 2: más viejo
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })

    const keeper = sorted[0]
    const duplicates = sorted.slice(1)

    for (const dup of duplicates) {
      console.log(`\nMERGE: "${dup.name}" (${dup.id}) → "${keeper.name}" (${keeper.id})`)
      console.log(`  CUIT: ${keeper.cuit}`)

      // Si el keeper tiene nombre = CUIT y el dup tiene nombre real, actualizar
      const keeperNameIsCuit = /^\d{2}-\d{8}-\d$/.test(keeper.name)
      if (keeperNameIsCuit && !/^\d{2}-\d{8}-\d$/.test(dup.name)) {
        console.log(`  → Actualizando nombre: "${keeper.name}" → "${dup.name}"`)
        if (!DRY_RUN) {
          await prisma.customer.update({
            where: { id: keeper.id },
            data: { name: dup.name },
          })
        }
      }

      // Mover relaciones del duplicado al keeper
      // Quotes
      const quotes = await prisma.quote.findMany({ where: { customerId: dup.id }, select: { id: true } })
      if (quotes.length > 0) {
        console.log(`  → Moviendo ${quotes.length} cotizaciones`)
        if (!DRY_RUN) {
          await prisma.quote.updateMany({ where: { customerId: dup.id }, data: { customerId: keeper.id } })
        }
      }

      // Delivery Notes
      const deliveryNotes = await prisma.deliveryNote.findMany({ where: { customerId: dup.id }, select: { id: true } })
      if (deliveryNotes.length > 0) {
        console.log(`  → Moviendo ${deliveryNotes.length} remitos`)
        if (!DRY_RUN) {
          await prisma.deliveryNote.updateMany({ where: { customerId: dup.id }, data: { customerId: keeper.id } })
        }
      }

      // Invoices
      const invoices = await prisma.invoice.findMany({ where: { customerId: dup.id }, select: { id: true } })
      if (invoices.length > 0) {
        console.log(`  → Moviendo ${invoices.length} facturas`)
        if (!DRY_RUN) {
          await prisma.invoice.updateMany({ where: { customerId: dup.id }, data: { customerId: keeper.id } })
        }
      }

      // Contacts
      const contacts = await prisma.contact.findMany({ where: { customerId: dup.id }, select: { id: true } })
      if (contacts.length > 0) {
        console.log(`  → Moviendo ${contacts.length} contactos`)
        if (!DRY_RUN) {
          await prisma.contact.updateMany({ where: { customerId: dup.id }, data: { customerId: keeper.id } })
        }
      }

      // Delivery Addresses
      const addresses = await prisma.customerDeliveryAddress.findMany({ where: { customerId: dup.id }, select: { id: true } })
      if (addresses.length > 0) {
        console.log(`  → Moviendo ${addresses.length} direcciones de entrega`)
        if (!DRY_RUN) {
          await prisma.customerDeliveryAddress.updateMany({ where: { customerId: dup.id }, data: { customerId: keeper.id } })
        }
      }

      // Borrar el duplicado
      console.log(`  → Eliminando duplicado ${dup.id}`)
      if (!DRY_RUN) {
        await prisma.customer.delete({ where: { id: dup.id } })
      }

      mergedCount++
    }
  }

  console.log(`\n=== RESULTADO: ${mergedCount} duplicados ${DRY_RUN ? 'encontrados (dry run)' : 'mergeados'} ===\n`)

  if (DRY_RUN) {
    console.log('Para ejecutar en vivo: npx tsx scripts/merge-duplicate-customers.ts')
    console.log('(sin --dry-run)\n')
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

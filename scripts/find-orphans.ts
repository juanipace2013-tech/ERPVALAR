/**
 * Detección de cotizaciones potencialmente afectadas por el bug COLPPY_ORPHAN
 * (factura emitida en Colppy pero ERP no la registró). SOLO LECTURA.
 *
 * Imprime TRES categorías separadas con sus respectivos counts:
 *
 *   CAT 1 — Real orphan (probable bug, recientes):
 *     Quote en ACCEPTED o FACTURADA_PARCIAL, sin cotizacion_facturas (en estado
 *     BORRADOR), creadas en los últimos 90 días. Si tienen un breadcrumb
 *     'ERROR_GUARDADO' en cotizacion_facturas, ya están confirmadas por el fix
 *     nuevo (post-deploy).
 *
 *   CAT 2 — Sospechoso (legacy vs bug):
 *     Quote en CONVERTED con colppyInvoiceId seteado, pero TODOS los quote_items
 *     con cantidadFacturada=0 y SIN cotizacion_facturas. Diferenciamos entre:
 *       - LEGACY: createdAt anterior al backfill (pre 2026-05-01) → flujo viejo
 *         legítimo donde aún no existía el modelo CotizacionFactura.
 *       - POSIBLE_BUG: createdAt posterior → no se persistió.
 *
 *   CAT 3 — Parcial roto (síntoma exacto del bug VAL-2026-521):
 *     Quote en FACTURADA_PARCIAL sin filas en cotizacion_facturas (BORRADOR).
 *     Es el escenario más severo: el operador vio "Facturación Parcial" en la
 *     UI pero no hay registro de la factura en el ERP.
 *
 * Correr:
 *   npx tsx scripts/find-orphans.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Fecha de corte para distinguir "legacy" del modelo CotizacionFactura.
// Ajustar si el deploy del modelo fue en otra fecha.
const LEGACY_CUTOFF = new Date('2026-05-01T00:00:00Z')

// Ventana reciente para Cat 1 (últimos 90 días).
const RECENT_CUTOFF = (() => {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d
})()

interface Row {
  quoteNumber: string
  cliente: string
  status: string
  currency: string
  totalUSD: number
  colppyInvoiceId: string | null
  colppySyncedAt: Date | null
  createdAt: Date
  updatedAt: Date
  itemsQty: number
  cantidadFacturadaSum: number
  cotizacionFacturasBORRADOR: number
  cotizacionFacturasERROR: number
}

function fmtRow(r: Row): string {
  return [
    r.quoteNumber.padEnd(15),
    (r.cliente || '').slice(0, 28).padEnd(28),
    r.status.padEnd(19),
    r.currency,
    String(r.totalUSD.toFixed(2)).padStart(10),
    `qty=${r.itemsQty}`.padStart(6),
    `fact=${r.cantidadFacturadaSum}`.padStart(9),
    `cf_ok=${r.cotizacionFacturasBORRADOR}`,
    `cf_err=${r.cotizacionFacturasERROR}`,
    r.createdAt.toISOString().slice(0, 10),
  ].join(' | ')
}

async function loadRows(where: any): Promise<Row[]> {
  const quotes = await prisma.quote.findMany({
    where,
    select: {
      quoteNumber: true,
      status: true,
      currency: true,
      total: true,
      colppyInvoiceId: true,
      colppySyncedAt: true,
      createdAt: true,
      updatedAt: true,
      customer: { select: { name: true } },
      items: {
        where: { isAlternative: false },
        select: { cantidadFacturada: true },
      },
      facturas: {
        select: { estado: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  })
  return quotes.map((q) => ({
    quoteNumber: q.quoteNumber,
    cliente: q.customer.name,
    status: q.status,
    currency: q.currency,
    totalUSD: Number(q.total),
    colppyInvoiceId: q.colppyInvoiceId,
    colppySyncedAt: q.colppySyncedAt,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
    itemsQty: q.items.length,
    cantidadFacturadaSum: q.items.reduce((s, i) => s + Number(i.cantidadFacturada), 0),
    cotizacionFacturasBORRADOR: q.facturas.filter((f) => f.estado === 'BORRADOR').length,
    cotizacionFacturasERROR: q.facturas.filter((f) => f.estado === 'ERROR_GUARDADO').length,
  }))
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(' DETECTOR DE ORPHANS COLPPY (solo lectura)')
  console.log(` LEGACY_CUTOFF: ${LEGACY_CUTOFF.toISOString().slice(0, 10)}`)
  console.log(` RECENT_CUTOFF: ${RECENT_CUTOFF.toISOString().slice(0, 10)}`)
  console.log('═══════════════════════════════════════════════════════════════\n')

  // ─────────────────────────────────────────────────────────────────────
  // CAT 1 — Real orphan (recientes, sin CotizacionFactura BORRADOR).
  //  Incluye los confirmados por el fix nuevo (con breadcrumb ERROR_GUARDADO)
  //  y los anteriores al fix (sin ningún breadcrumb).
  // ─────────────────────────────────────────────────────────────────────
  const cat1 = await loadRows({
    status: { in: ['ACCEPTED', 'FACTURADA_PARCIAL'] },
    createdAt: { gte: RECENT_CUTOFF },
    facturas: { none: { estado: 'BORRADOR' } },
    OR: [
      { colppySyncedAt: { not: null } },
      { facturas: { some: { estado: 'ERROR_GUARDADO' } } },
      { items: { some: { cantidadFacturada: { gt: 0 } } } },
    ],
  })

  // Distinguir confirmados (con breadcrumb) de probables (sin breadcrumb)
  const cat1Confirmed = cat1.filter((r) => r.cotizacionFacturasERROR > 0)
  const cat1Probable = cat1.filter((r) => r.cotizacionFacturasERROR === 0)

  console.log('─── CATEGORÍA 1: REAL ORPHAN ─────────────────────────────────')
  console.log(`Total: ${cat1.length}  |  Confirmados (breadcrumb ERROR_GUARDADO): ${cat1Confirmed.length}  |  Probables: ${cat1Probable.length}\n`)

  if (cat1Confirmed.length > 0) {
    console.log('  ── Confirmados por breadcrumb del fix nuevo:')
    for (const r of cat1Confirmed) console.log('   ', fmtRow(r))
    console.log()
  }
  if (cat1Probable.length > 0) {
    console.log('  ── Probables (sin breadcrumb, anteriores al fix):')
    for (const r of cat1Probable) console.log('   ', fmtRow(r))
    console.log()
  }
  if (cat1.length === 0) {
    console.log('  (nada)\n')
  }

  // ─────────────────────────────────────────────────────────────────────
  // CAT 2 — Sospechoso (CONVERTED con colppyInvoiceId pero todos los items
  //   en cantidadFacturada=0 y sin cotizacion_facturas BORRADOR).
  // ─────────────────────────────────────────────────────────────────────
  const cat2 = await loadRows({
    status: 'CONVERTED',
    colppyInvoiceId: { not: null },
    facturas: { none: { estado: 'BORRADOR' } },
    items: {
      every: {
        OR: [{ cantidadFacturada: 0 }, { isAlternative: true }],
      },
      some: { isAlternative: false },
    },
  })
  const cat2Legacy = cat2.filter((r) => r.createdAt < LEGACY_CUTOFF)
  const cat2Bug = cat2.filter((r) => r.createdAt >= LEGACY_CUTOFF)

  console.log('─── CATEGORÍA 2: SOSPECHOSO (CONVERTED sin trazas) ───────────')
  console.log(`Total: ${cat2.length}  |  Legacy (pre cutoff): ${cat2Legacy.length}  |  Posible bug (post cutoff): ${cat2Bug.length}\n`)

  if (cat2Bug.length > 0) {
    console.log('  ── POSIBLE BUG (creadas después del LEGACY_CUTOFF):')
    for (const r of cat2Bug) console.log('   ', fmtRow(r))
    console.log()
  }
  if (cat2Legacy.length > 0) {
    console.log(`  ── Legacy (${cat2Legacy.length} filas, primeras 10):`)
    for (const r of cat2Legacy.slice(0, 10)) console.log('   ', fmtRow(r))
    if (cat2Legacy.length > 10) console.log(`     ...y ${cat2Legacy.length - 10} más`)
    console.log()
  }
  if (cat2.length === 0) {
    console.log('  (nada)\n')
  }

  // ─────────────────────────────────────────────────────────────────────
  // CAT 3 — Parcial roto (FACTURADA_PARCIAL sin cotizacion_facturas BORRADOR).
  //   Síntoma exacto del caso VAL-2026-521.
  // ─────────────────────────────────────────────────────────────────────
  const cat3 = await loadRows({
    status: 'FACTURADA_PARCIAL',
    facturas: { none: { estado: 'BORRADOR' } },
  })

  console.log('─── CATEGORÍA 3: PARCIAL ROTO ────────────────────────────────')
  console.log(`Total: ${cat3.length}\n`)
  if (cat3.length > 0) {
    for (const r of cat3) console.log('   ', fmtRow(r))
    console.log()
  } else {
    console.log('  (nada)\n')
  }

  // ─────────────────────────────────────────────────────────────────────
  // Resumen final
  // ─────────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(' RESUMEN')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(` CAT 1 (Real orphan recientes):      ${cat1.length.toString().padStart(4)} (confirmados ${cat1Confirmed.length}, probables ${cat1Probable.length})`)
  console.log(` CAT 2 (Sospechoso CONVERTED):       ${cat2.length.toString().padStart(4)} (legacy ${cat2Legacy.length}, posible bug ${cat2Bug.length})`)
  console.log(` CAT 3 (Parcial roto):               ${cat3.length.toString().padStart(4)}`)
  console.log()
  console.log(' Prioridad de reconciliación:')
  console.log('   1) Cat 1 confirmados (breadcrumb explícito)')
  console.log('   2) Cat 3 (sintoma claro del bug)')
  console.log('   3) Cat 2 posible_bug (revisar caso por caso)')
  console.log('   4) Cat 2 legacy (decidir si vale reconciliar a posteriori)')
  console.log('═══════════════════════════════════════════════════════════════')
}

main()
  .catch((e) => {
    console.error('Error fatal:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

/**
 * Reconciliación manual de facturas COLPPY_ORPHAN: la factura existe en Colppy
 * pero el ERP no la registró (transacción local falló después de que Colppy
 * confirmó la emisión).
 *
 * Para cada entrada del array `orphans` de abajo:
 *   - Crea Invoice (legacy) marcada como reconciliación manual.
 *   - Crea CotizacionFactura con estado='BORRADOR' (la factura SÍ existe en
 *     Colppy, no es un error: solo se reconcilia el registro).
 *   - Incrementa cantidadFacturada en cada QuoteItem según itemsFacturados[].
 *   - Recalcula status del Quote (CONVERTED o FACTURADA_PARCIAL).
 *   - Crea QuoteStatusHistory + AuditLog con action='RECONCILE_ORPHAN'.
 *
 * Idempotente: salta entradas cuyo colppyInvoiceId ya tenga una CotizacionFactura.
 *
 * Modo:
 *   --dry-run    (DEFAULT) Solo imprime qué haría, NO escribe.
 *   --apply      Ejecuta las operaciones contra la DB.
 *
 * Uso:
 *   npx tsx scripts/reconcile-orphan-colppy-invoices.ts            # dry-run
 *   npx tsx scripts/reconcile-orphan-colppy-invoices.ts --apply    # aplica
 *
 * IMPORTANTE: completar el campo `colppyInvoiceId` de cada entrada antes de
 * correr (el ID interno de Colppy se obtiene desde la UI de Colppy o via su API).
 */

import { PrismaClient, QuoteStatus } from '@prisma/client'

const prisma = new PrismaClient()
const isDryRun = !process.argv.includes('--apply')

interface OrphanItem {
  /** SKU/código del producto en el QuoteItem (matcheamos por productSku || sku) */
  codigo: string
  /** Cantidad efectivamente facturada en Colppy para este ítem */
  cantidad: number
}

interface OrphanEntry {
  quoteNumber: string
  /** ID interno de Colppy (string). Completar antes de correr. */
  colppyInvoiceId: string
  /** Número de factura visible (ej: '0003-00000221') */
  colppyInvoiceNumber: string
  /**
   * Fecha de emisión en Colppy.
   *
   * ⚠️ TODO TZ: `new Date('YYYY-MM-DD')` JS lo interpreta como medianoche UTC,
   * que en Argentina (UTC-3) es 21:00 del día anterior. La UI usa toLocaleString
   * con TZ del browser y muestra el día corrido (ej: "26/05 21:00" en vez de
   * "27/05 12:00"). Para evitarlo usar `new Date('YYYY-MM-DDT15:00:00Z')` (=
   * mediodía ART) hasta que se centralice un helper de civil-date.
   *
   * VAL-2026-521 ya quedó persistida con este offset; corregir manualmente con
   * UPDATE si molesta, o aceptar la cosmética (no afecta lógica de facturación).
   */
  fecha: Date
  /** TC USD→ARS usado al momento de emitir (para montos en ARS) */
  tipoCambio: number
  /** Items facturados con cantidad real enviada a Colppy */
  itemsFacturados: OrphanItem[]
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPLETAR ANTES DE CORRER
// ─────────────────────────────────────────────────────────────────────────────
const orphans: OrphanEntry[] = [
  {
    quoteNumber: 'VAL-2026-521',
    colppyInvoiceId: '<COMPLETAR_DESPUES>',
    colppyInvoiceNumber: '0003-00000221',
    fecha: new Date('2026-05-27T15:00:00Z'), // ver nota TODO TZ arriba
    tipoCambio: 1430,
    itemsFacturados: [
      // Cantidad efectivamente facturada en Colppy por cada ítem
      // { codigo: '2094-14', cantidad: 9 },
      // { codigo: '2094-12', cantidad: 12 },
    ],
  },
]

interface ProcessResult {
  quoteNumber: string
  status: 'OK' | 'SKIP_ALREADY_RECONCILED' | 'ERROR'
  message: string
  detail?: any
}

async function processOrphan(entry: OrphanEntry): Promise<ProcessResult> {
  // 1) Cargar cotización + items + customer
  const quote = await prisma.quote.findFirst({
    where: { quoteNumber: entry.quoteNumber },
    include: {
      customer: { select: { id: true, name: true, taxCondition: true, paymentTerms: true } },
      items: {
        where: { isAlternative: false },
        include: { product: { select: { sku: true } } },
      },
    },
  })

  if (!quote) {
    return {
      quoteNumber: entry.quoteNumber,
      status: 'ERROR',
      message: 'Cotización no encontrada',
    }
  }

  // 2) Idempotencia: si ya existe la CotizacionFactura, no procesar.
  const existing = await prisma.cotizacionFactura.findFirst({
    where: { colppyInvoiceId: entry.colppyInvoiceId },
    select: { id: true, estado: true },
  })
  if (existing) {
    return {
      quoteNumber: entry.quoteNumber,
      status: 'SKIP_ALREADY_RECONCILED',
      message: `Ya existe CotizacionFactura id=${existing.id} estado=${existing.estado}`,
    }
  }

  // 3) Matchear itemsFacturados[] contra los QuoteItem por código (SKU)
  const matches: Array<{
    quoteItemId: string
    cantidad: number
    unitPrice: number
    descripcion: string
    productId: string | null
    sku: string
  }> = []
  const unmatched: string[] = []
  for (const it of entry.itemsFacturados) {
    const qi = quote.items.find((q) => {
      const productSku = q.product?.sku || (q as any).productSku || (q as any).sku
      return productSku === it.codigo || (q as any).sku === it.codigo
    })
    if (!qi) {
      unmatched.push(it.codigo)
      continue
    }
    matches.push({
      quoteItemId: qi.id,
      cantidad: it.cantidad,
      unitPrice: Number(qi.unitPrice),
      descripcion: qi.description || qi.product?.sku || 'Item',
      productId: qi.productId || null,
      sku: qi.product?.sku || (qi as any).sku || it.codigo,
    })
  }

  if (unmatched.length > 0) {
    return {
      quoteNumber: entry.quoteNumber,
      status: 'ERROR',
      message: `Códigos sin match en la cotización: ${unmatched.join(', ')}`,
    }
  }

  if (matches.length === 0) {
    return {
      quoteNumber: entry.quoteNumber,
      status: 'ERROR',
      message: 'No hay items facturados a registrar',
    }
  }

  // 4) Calcular montos
  const subtotal = matches.reduce((s, m) => s + m.unitPrice * m.cantidad, 0)
  const tc = entry.tipoCambio || 1
  const isUSD = quote.currency === 'USD'
  const montoUSD = isUSD ? subtotal : subtotal / (tc || 1)
  const montoARS = isUSD ? subtotal * tc : subtotal
  const invoiceType = quote.customer.taxCondition === 'RESPONSABLE_INSCRIPTO' ? 'A' : 'B'

  // 5) Calcular dueDate manualmente (igual que calcDueDate del lib, pero
  // evitamos importar para no atar el script a tipos del runtime principal)
  const dueDate = new Date(entry.fecha)
  dueDate.setDate(dueDate.getDate() + (quote.customer.paymentTerms || 30))

  // Usar el salesPerson del Quote como creador del registro (idéntico patrón
  // que generate-invoice cuando hay session)
  const createdById = quote.salesPersonId

  const detail = {
    cliente: quote.customer.name,
    currency: quote.currency,
    subtotal,
    montoUSD,
    montoARS,
    tipoCambio: tc,
    invoiceType,
    itemsCount: matches.length,
    matches,
  }

  if (isDryRun) {
    return {
      quoteNumber: entry.quoteNumber,
      status: 'OK',
      message: 'DRY-RUN — operaciones planeadas',
      detail,
    }
  }

  // 6) Aplicar todo en transacción atómica
  await prisma.$transaction(
    async (tx) => {
      const newInvoice = await tx.invoice.create({
        data: {
          invoiceNumber: `BORRADOR-COLPPY-${entry.colppyInvoiceNumber}`,
          invoiceType,
          transactionType: 'SALE',
          quoteId: quote.id,
          customerId: quote.customerId,
          userId: createdById,
          status: 'DRAFT',
          currency: quote.currency,
          exchangeRate: quote.exchangeRate,
          colppyId: entry.colppyInvoiceId,
          subtotal,
          taxAmount: 0,
          discount: 0,
          total: subtotal,
          balance: subtotal,
          issueDate: entry.fecha,
          dueDate,
          notes:
            `Reconciliación manual orphan COLPPY — script reconcile-orphan-colppy-invoices.ts. ` +
            `Factura Colppy: ${entry.colppyInvoiceNumber} (id ${entry.colppyInvoiceId}).`,
          afipStatus: 'PENDING',
          paymentStatus: 'UNPAID',
          items: {
            create: matches.map((m) => ({
              productId: m.productId,
              quoteItemId: m.quoteItemId,
              description: m.descripcion,
              quantity: m.cantidad,
              unitPrice: m.unitPrice,
              discount: 0,
              taxRate: 21,
              subtotal: m.unitPrice * m.cantidad,
            })),
          },
        },
      })

      await tx.cotizacionFactura.create({
        data: {
          cotizacionId: quote.id,
          invoiceId: newInvoice.id,
          colppyInvoiceId: entry.colppyInvoiceId,
          numeroFactura: entry.colppyInvoiceNumber,
          fecha: entry.fecha,
          montoUSD,
          montoARS,
          tipoCambio: tc,
          estado: 'BORRADOR',
          createdById,
          items: {
            create: matches.map((m) => ({
              cotizacionItemId: m.quoteItemId,
              cantidad: m.cantidad,
              precioUnitario: m.unitPrice,
              subtotal: m.unitPrice * m.cantidad,
            })),
          },
        },
      })

      // Incrementar cantidadFacturada
      for (const m of matches) {
        await tx.quoteItem.update({
          where: { id: m.quoteItemId },
          data: { cantidadFacturada: { increment: m.cantidad } },
        })
      }

      // Recalcular status (relectura post-incremento)
      const refreshed = await tx.quoteItem.findMany({
        where: { quoteId: quote.id, isAlternative: false },
        include: {
          invoiceItems: {
            include: { invoice: { select: { status: true } } },
          },
        },
      })
      const isFullyInvoiced = refreshed.every((i) => {
        const fromInvoiceItems = i.invoiceItems
          .filter((ii) => ii.invoice.status !== 'CANCELLED')
          .reduce((sum, ii) => sum + Number(ii.quantity), 0)
        const fromColumn = Number(i.cantidadFacturada)
        return Math.max(fromInvoiceItems, fromColumn) >= Number(i.quantity)
      })
      const newStatus: QuoteStatus = isFullyInvoiced
        ? QuoteStatus.CONVERTED
        : QuoteStatus.FACTURADA_PARCIAL
      const fromStatus = quote.status

      await tx.quote.update({
        where: { id: quote.id },
        data: {
          status: newStatus,
          colppyInvoiceId: entry.colppyInvoiceId,
          colppySyncedAt: entry.fecha,
          statusUpdatedAt: new Date(),
          statusUpdatedBy: createdById,
        },
      })

      await tx.quoteStatusHistory.create({
        data: {
          quoteId: quote.id,
          fromStatus,
          toStatus: newStatus,
          changedBy: createdById,
          notes:
            `Reconciliación manual orphan COLPPY — script reconcile-orphan-colppy-invoices.ts. ` +
            `Factura Colppy: ${entry.colppyInvoiceNumber}.`,
        },
      })

      await tx.auditLog.create({
        data: {
          userId: createdById,
          userName: 'reconcile-script',
          userEmail: 'reconcile-script@val-arg.local',
          action: 'RECONCILE_ORPHAN',
          entity: 'QUOTE',
          entityId: quote.id,
          entityRef: quote.quoteNumber,
          description:
            `Reconciliación manual de factura orphan COLPPY — ` +
            `quote=${quote.quoteNumber}, facturaColppy=${entry.colppyInvoiceNumber} (id ${entry.colppyInvoiceId}). ` +
            `Status transitado: ${fromStatus} → ${newStatus}.`,
        },
      })
    },
    { maxWait: 10000, timeout: 30000 }
  )

  return {
    quoteNumber: entry.quoteNumber,
    status: 'OK',
    message: 'Reconciliada',
    detail,
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(' Reconciliación orphan COLPPY')
  console.log(` Modo: ${isDryRun ? 'DRY-RUN (no escribe)' : 'APPLY (escribe en DB)'}`)
  console.log(` Entradas: ${orphans.length}`)
  console.log('═══════════════════════════════════════════════════════════════\n')

  // Validación previa: bloquear si hay placeholders sin completar
  const incompletos = orphans.filter(
    (o) =>
      o.colppyInvoiceId.includes('<') ||
      o.colppyInvoiceId.includes('COMPLETAR') ||
      o.itemsFacturados.length === 0
  )
  if (incompletos.length > 0) {
    console.error('❌ Hay entradas incompletas (colppyInvoiceId placeholder o itemsFacturados vacío):')
    for (const o of incompletos) {
      console.error(`   - ${o.quoteNumber}`)
    }
    console.error('\nCompletar y volver a correr.\n')
    process.exit(1)
  }

  const results: ProcessResult[] = []
  for (const entry of orphans) {
    try {
      const r = await processOrphan(entry)
      results.push(r)
    } catch (e: any) {
      results.push({
        quoteNumber: entry.quoteNumber,
        status: 'ERROR',
        message: e?.message || 'Error desconocido',
        detail: { stack: e?.stack },
      })
    }
  }

  // Resumen
  console.log('\n─── Resultados ─────────────────────────────────────────────\n')
  for (const r of results) {
    const icon = r.status === 'OK' ? '✓' : r.status === 'SKIP_ALREADY_RECONCILED' ? '↺' : '✗'
    console.log(`${icon} ${r.quoteNumber}: ${r.status} — ${r.message}`)
    if (r.detail) console.log(`   detail: ${JSON.stringify(r.detail, null, 2)}\n`)
  }

  const ok = results.filter((r) => r.status === 'OK').length
  const skip = results.filter((r) => r.status === 'SKIP_ALREADY_RECONCILED').length
  const err = results.filter((r) => r.status === 'ERROR').length
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log(` Total procesadas: ${results.length}  |  OK: ${ok}  |  skip: ${skip}  |  errores: ${err}`)
  console.log('═══════════════════════════════════════════════════════════════')
  if (isDryRun) {
    console.log('\nDRY-RUN — no se aplicaron cambios.')
    console.log('Para aplicar:  npx tsx scripts/reconcile-orphan-colppy-invoices.ts --apply\n')
  }
}

main()
  .catch((e) => {
    console.error('Error fatal:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

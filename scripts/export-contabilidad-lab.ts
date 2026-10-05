/**
 * Exportador de sólo lectura para el laboratorio contable standalone
 * (valarg-contabilidad). Genera CSVs con datos reales del ERP para llevar la
 * contabilidad en paralelo sin tocar nada operativo: acá no se escribe ni una
 * fila, sólo SELECT.
 *
 * Archivos generados (separador ";", decimales con coma, fechas AAAA-MM-DD):
 *   cotizaciones.csv                     fecha;cotizacion (USD->ARS, todas las
 *                                        fechas cargadas; formato que importa
 *                                        la Tesorería del lab)
 *   facturas-compra-<mes>.csv            cabeceras con totales declarados
 *   facturas-compra-items-<mes>.csv      renglones (lista + dto + alícuota)
 *   facturas-compra-iva-<mes>.csv        IVA por alícuota declarado
 *   facturas-compra-percepciones-<mes>.csv
 *   ventas-<mes>.csv                     comprobantes de venta con CAE
 *                                        aprobado (hoy emitidos por Colppy;
 *                                        incluye NC/ND)
 *   ventas-items-<mes>.csv               renglones de esas facturas
 *
 * Uso (en el VPS, que tiene la DB de prod):
 *   npx tsx scripts/export-contabilidad-lab.ts --mes 2026-10
 *   npx tsx scripts/export-contabilidad-lab.ts --desde 2026-10-01 --hasta 2026-10-15
 *   npx tsx scripts/export-contabilidad-lab.ts --mes 2026-10 --out /tmp/lab
 *
 * Después: scp de los archivos a la PC y carga en el lab (cotizaciones por
 * Tesorería; compras/ventas sirven de fuente para registrar y controlar al
 * centavo).
 */
import { PrismaClient, Prisma } from '@prisma/client'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const prisma = new PrismaClient()

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function resolveRange(): { desde: Date; hasta: Date; label: string } {
  const mes = arg('mes')
  if (mes) {
    if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error(`--mes inválido: ${mes} (usar AAAA-MM)`)
    const [y, m] = mes.split('-').map(Number)
    return {
      desde: new Date(Date.UTC(y, m - 1, 1)),
      hasta: new Date(Date.UTC(y, m, 1)), // exclusivo
      label: mes,
    }
  }
  const desde = arg('desde')
  const hasta = arg('hasta')
  if (!desde || !hasta) throw new Error('Indicar --mes AAAA-MM o --desde/--hasta AAAA-MM-DD')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta))
    throw new Error('Fechas con formato AAAA-MM-DD')
  const h = new Date(`${hasta}T00:00:00Z`)
  h.setUTCDate(h.getUTCDate() + 1) // hasta inclusivo
  return { desde: new Date(`${desde}T00:00:00Z`), hasta: h, label: `${desde}_a_${hasta}` }
}

// ---------------------------------------------------------------------------
// Formato CSV (el lab parsea ";" con decimales con coma y fechas AAAA-MM-DD)
// ---------------------------------------------------------------------------

const fecha = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '')

const num = (v: Prisma.Decimal | number | null | undefined) =>
  v == null ? '' : String(v).replace('.', ',')

function esc(v: string | null | undefined): string {
  const s = v ?? ''
  // Comillas de pulgadas (1/2") y ";" en descripciones: campo entre comillas.
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csv(headers: string[], rows: (string | undefined)[][]): string {
  return [headers.join(';'), ...rows.map((r) => r.map((c) => c ?? '').join(';'))].join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------------------

async function exportCotizaciones(outDir: string) {
  const rates = await prisma.exchangeRate.findMany({
    where: { fromCurrency: 'USD', toCurrency: 'ARS' },
    orderBy: { validFrom: 'asc' },
    select: { validFrom: true, rate: true },
  })
  // Una por fecha: si hubo correcciones el mismo día, gana la última cargada.
  const byDate = new Map<string, string>()
  for (const r of rates) byDate.set(fecha(r.validFrom), num(r.rate))
  const rows = [...byDate.entries()].map(([f, c]) => [f, c])
  writeFileSync(join(outDir, 'cotizaciones.csv'), csv(['fecha', 'cotizacion'], rows))
  return rows.length
}

async function exportCompras(outDir: string, desde: Date, hasta: Date, label: string) {
  const invoices = await prisma.purchaseInvoice.findMany({
    where: { invoiceDate: { gte: desde, lt: hasta } },
    orderBy: { invoiceDate: 'asc' },
    include: {
      supplier: { select: { name: true, taxId: true } },
      items: { include: { product: { select: { sku: true } } } },
      taxes: true,
      perceptions: true,
    },
  })

  const cab: string[][] = []
  const items: string[][] = []
  const iva: string[][] = []
  const perc: string[][] = []
  for (const f of invoices) {
    cab.push([
      esc(f.invoiceNumber),
      esc(f.supplier.name),
      esc(f.supplier.taxId),
      f.invoiceType, // FA / NC / ND
      f.voucherType, // A / B / C
      fecha(f.invoiceDate),
      fecha(f.dueDate),
      f.currency,
      num(f.exchangeRate),
      num(f.generalDiscount),
      num(f.netAmount),
      num(f.notTaxedAmount),
      num(f.exemptAmount),
      num(f.taxAmount),
      num(f.perceptionsAmount),
      num(f.total),
      esc(f.reviewReason), // no vacío = quedó marcada para revisión en el ERP
    ])
    for (const it of f.items)
      items.push([
        esc(f.invoiceNumber),
        esc(it.supplierProductCode),
        esc(it.product?.sku),
        esc(it.description),
        esc(it.unit),
        num(it.quantity),
        num(it.listPrice),
        num(it.discountPercent),
        num(it.unitPrice),
        num(it.taxRate),
        num(it.subtotal),
      ])
    for (const t of f.taxes)
      iva.push([esc(f.invoiceNumber), num(t.rate), num(t.baseAmount), num(t.taxAmount)])
    for (const p of f.perceptions)
      perc.push([
        esc(f.invoiceNumber),
        esc(p.jurisdiction),
        esc(p.perceptionType),
        num(p.rate),
        num(p.baseAmount),
        num(p.amount),
      ])
  }

  writeFileSync(
    join(outDir, `facturas-compra-${label}.csv`),
    csv(
      ['numero', 'proveedor', 'cuit', 'tipo', 'letra', 'fecha', 'vencimiento', 'moneda', 'cotizacion', 'dto_general', 'neto', 'no_gravado', 'exento', 'iva', 'percepciones', 'total', 'revision'],
      cab
    )
  )
  writeFileSync(
    join(outDir, `facturas-compra-items-${label}.csv`),
    csv(
      ['numero', 'codigo_proveedor', 'sku_erp', 'descripcion', 'unidad', 'cantidad', 'precio_lista', 'dto_pct', 'precio_unitario', 'alicuota', 'subtotal'],
      items
    )
  )
  writeFileSync(
    join(outDir, `facturas-compra-iva-${label}.csv`),
    csv(['numero', 'alicuota', 'base', 'importe'], iva)
  )
  writeFileSync(
    join(outDir, `facturas-compra-percepciones-${label}.csv`),
    csv(['numero', 'jurisdiccion', 'tipo', 'alicuota', 'base', 'importe'], perc)
  )
  return invoices.length
}

async function exportVentas(outDir: string, desde: Date, hasta: Date, label: string) {
  // Comprobantes de venta con CAE aprobado del período. Hoy los emite Colppy
  // (PV 0003, emitidaPor null); cuando arranque la emisión propia (ARCA PV 7)
  // salen igual, distinguidos por la columna emitida_por.
  const invoices = await prisma.invoice.findMany({
    where: {
      transactionType: { in: ['SALE', 'CREDIT_NOTE', 'DEBIT_NOTE'] },
      afipStatus: 'APPROVED',
      status: { not: 'CANCELLED' },
      issueDate: { gte: desde, lt: hasta },
    },
    orderBy: { issueDate: 'asc' },
    include: {
      customer: { select: { name: true, businessName: true, cuit: true } },
      // Las facturas de cotización guardan el producto pero no siempre el SKU en el renglón.
      items: { include: { product: { select: { sku: true } } } },
      relatedInvoice: { select: { invoiceNumber: true } },
    },
  })

  const cab: string[][] = []
  const items: string[][] = []
  for (const f of invoices) {
    cab.push([
      esc(f.invoiceNumber),
      f.invoiceType, // A / B / C / E
      f.transactionType, // SALE / CREDIT_NOTE / DEBIT_NOTE
      esc(f.customer.businessName || f.customer.name),
      esc(f.customer.cuit),
      fecha(f.issueDate),
      fecha(f.dueDate),
      f.currency,
      num(f.exchangeRate),
      num(f.subtotal),
      num(f.taxAmount),
      num(f.discount),
      num(f.total),
      esc(f.cae),
      esc(f.relatedInvoice?.invoiceNumber), // NC/ND: comprobante original
      esc(f.emitidaPor ?? 'COLPPY'),
    ])
    for (const it of f.items)
      items.push([
        esc(f.invoiceNumber),
        esc(it.sku || it.product?.sku),
        esc(it.description),
        num(it.quantity),
        num(it.unitPrice),
        num(it.discount),
        num(it.taxRate),
        num(it.subtotal),
      ])
  }

  writeFileSync(
    join(outDir, `ventas-${label}.csv`),
    csv(
      ['numero', 'letra', 'transaccion', 'cliente', 'cuit', 'fecha', 'vencimiento', 'moneda', 'cotizacion', 'neto', 'iva', 'descuento', 'total', 'cae', 'comprobante_original', 'emitida_por'],
      cab
    )
  )
  writeFileSync(
    join(outDir, `ventas-items-${label}.csv`),
    csv(['numero', 'sku', 'descripcion', 'cantidad', 'precio_unitario', 'dto_pct', 'alicuota', 'subtotal'], items)
  )
  return invoices.length
}

async function main() {
  const { desde, hasta, label } = resolveRange()
  const outDir = arg('out') ?? join('outputs', 'contabilidad-lab')
  mkdirSync(outDir, { recursive: true })

  console.log(`Exportando ${fecha(desde)} a ${fecha(hasta)} (exclusivo) en ${outDir}/`)
  const cotizaciones = await exportCotizaciones(outDir)
  console.log(`  cotizaciones.csv: ${cotizaciones} fechas USD->ARS`)
  const compras = await exportCompras(outDir, desde, hasta, label)
  console.log(`  facturas-compra-${label}.csv: ${compras} comprobantes (+items/iva/percepciones)`)
  const ventas = await exportVentas(outDir, desde, hasta, label)
  console.log(`  ventas-${label}.csv: ${ventas} comprobantes de venta con CAE (+items)`)
  console.log('Listo. Sólo lectura: no se modificó ningún dato.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

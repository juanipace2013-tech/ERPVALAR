/**
 * Repara los envíos del ERP a Colppy (CotizacionFactura) que perdieron su
 * factura por la limpieza del sync (borraba las facturas impagas a diario y
 * las recreaba sin cotización ni ítems; corregido el 1/10/2026), y los que
 * quedaron con el número provisorio del borrador / estado BORRADOR aunque
 * Colppy ya los emitió. Usa la misma vinculación que el sync
 * (src/lib/facturacion/vincular-envio-colppy.ts).
 *
 * ORDEN (las facturas viejas que borró la limpieza solo vuelven con un sync amplio):
 *   1. Deployar el sync corregido (sin la limpieza que borraba facturas).
 *   2. Correr UNA VEZ el sync con ventana amplia, con el código nuevo:
 *        npx tsx scripts/sync-colppy-diario.ts 180
 *      (importa las parcialmente cobradas y las borradas, gradúa los
 *      BORRADOR-COLPPY viejos y los vincula con su envío).
 *   3. Este script para lo que quede. No correrlo mientras corre un sync.
 *
 *   npx tsx scripts/reparar-envios-colppy.ts           (simulación)
 *   npx tsx scripts/reparar-envios-colppy.ts --apply
 */
import { prisma } from '@/lib/prisma'
import { ESTADOS_ENVIO_NO_VINCULABLES, esNumeroColppy, vincularEnvioColppy } from '@/lib/facturacion/vincular-envio-colppy'

const apply = process.argv.includes('--apply')

async function main() {
  const systemUser = await prisma.user.findFirst({ select: { id: true } }) // mismo default que el sync
  const envios = await prisma.cotizacionFactura.findMany({
    where: { colppyInvoiceId: { not: null }, estado: { notIn: ESTADOS_ENVIO_NO_VINCULABLES } },
    select: {
      id: true, colppyInvoiceId: true, invoiceId: true, numeroFactura: true, estado: true, fecha: true, cotizacionId: true,
      cotizacion: { select: { quoteNumber: true } },
      invoice: { select: { emitidaPor: true } },
    },
    orderBy: { fecha: 'asc' },
  })
  // Las facturas emitidas por el ERP (ARCA, A-0007-...) ya nacen vinculadas: no se tocan
  const arcaIds = new Set(
    (await prisma.invoice.findMany({ where: { emitidaPor: 'ARCA', colppyId: { not: null } }, select: { colppyId: true } })).map((i) => i.colppyId!)
  )
  const pendientes = envios.filter(
    (e) =>
      e.invoice?.emitidaPor !== 'ARCA' &&
      !arcaIds.has(e.colppyInvoiceId!) &&
      (!e.invoiceId || e.estado === 'BORRADOR' || !esNumeroColppy(e.numeroFactura))
  )
  console.log(`Envíos vigentes con id de Colppy: ${envios.length}; a revisar: ${pendientes.length}`)

  const stats = { vinculables: 0, sinFactura: 0, facturaNoEmitida: 0, conflicto: 0, aplicados: 0, items: 0, quotes: 0, errores: 0 }
  const sinFactura: string[] = []
  for (const e of pendientes) {
    const inv = await prisma.invoice.findFirst({
      where: { colppyId: e.colppyInvoiceId!, OR: [{ emitidaPor: null }, { emitidaPor: { not: 'ARCA' } }] },
      select: {
        id: true, colppyId: true, invoiceNumber: true, currency: true, quoteId: true, status: true,
        cotizacionFactura: { select: { id: true } },
        _count: { select: { items: true } },
      },
    })
    if (!inv) {
      stats.sinFactura++
      sinFactura.push(`${e.cotizacion.quoteNumber} colppy ${e.colppyInvoiceId} (${e.fecha.toISOString().slice(0, 10)})`)
      continue
    }
    if (!esNumeroColppy(inv.invoiceNumber)) {
      stats.facturaNoEmitida++ // sigue como BORRADOR-COLPPY en el ERP: la gradúa y vincula el sync amplio (paso 2)
      continue
    }
    if (inv.cotizacionFactura && inv.cotizacionFactura.id !== e.id) {
      stats.conflicto++
      console.log(`  CONFLICTO ${e.cotizacion.quoteNumber}: la factura ${inv.invoiceNumber} ya está vinculada a otro envío`)
      continue
    }
    stats.vinculables++
    const cambios = [
      !e.invoiceId ? 'vincular factura' : '',
      e.numeroFactura !== inv.invoiceNumber ? `nro ${e.numeroFactura} → ${inv.invoiceNumber}` : '',
      e.estado === 'BORRADOR' ? 'BORRADOR → EMITIDA' : '',
      inv.quoteId !== e.cotizacionId ? `cotización ${inv.quoteId ? 'OTRA' : 'null'} → ${e.cotizacion.quoteNumber}` : '',
      inv._count.items === 0 ? 'reconstruir ítems' : '',
    ].filter(Boolean)
    if (!apply) {
      if (stats.vinculables <= 25) console.log(`  ${e.cotizacion.quoteNumber} ${inv.invoiceNumber} (${inv.status}): ${cambios.join(', ')}`)
      continue
    }
    try {
      const r = await prisma.$transaction((tx) =>
        vincularEnvioColppy(
          tx,
          { id: inv.id, colppyId: inv.colppyId!, invoiceNumber: inv.invoiceNumber, currency: inv.currency, quoteId: inv.quoteId },
          { systemUserId: systemUser?.id }
        )
      )
      if (r.vinculado) {
        stats.aplicados++
        stats.items += r.itemsCreados ?? 0
        if (r.quoteCambiado) stats.quotes++
      } else console.log(`  NO vinculado ${e.cotizacion.quoteNumber}: ${r.motivo}`)
    } catch (err) {
      stats.errores++
      console.log(`  ERROR ${e.cotizacion.quoteNumber}: ${(err as Error).message}`)
    }
  }
  console.log('\nResumen:', JSON.stringify(stats))
  if (sinFactura.length) {
    console.log(`Envíos cuya factura no está en el ERP (${sinFactura.length}): correr primero el sync amplio (paso 2); si siguen, revisar en Colppy (anuladas o borradas):`)
    for (const s of sinFactura.slice(0, 40)) console.log('  ' + s)
  }
  if (stats.facturaNoEmitida) console.log(`${stats.facturaNoEmitida} envíos con factura todavía BORRADOR-COLPPY en el ERP: los gradúa el sync amplio (paso 2); si siguen, el borrador no existe en Colppy (revisar a mano).`)
  if (!apply) console.log('\nSIMULACIÓN: no se cambió nada. Correr con --apply.')
}

main()
  .catch((e) => { console.error('ERROR:', (e as Error).message); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())

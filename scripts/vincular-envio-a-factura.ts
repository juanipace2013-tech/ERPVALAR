/**
 * Vincula a mano el envío de una cotización (CotizacionFactura en BORRADOR,
 * cuyo borrador ya no existe en Colppy) con la factura real que se hizo en
 * Colppy como comprobante aparte. Caso típico: el ERP mandó el borrador, en
 * Colppy se borró y se facturó de nuevo, y el sync no puede relacionarlos.
 *
 * Hace, en una transacción:
 *   - los ítems del borrador del ERP (BORRADOR-COLPPY-..., DRAFT) pasan a la
 *     factura real y el borrador queda CANCELLED (lo facturado se cuenta una vez);
 *   - el envío apunta a la factura real (colppyInvoiceId, número, EMITIDA);
 *   - la factura real toma la cotización (y su vendedor si tenía el default).
 * Las comisiones no cambian (salen del envío: misma fecha e importe).
 *
 *   npx tsx scripts/vincular-envio-a-factura.ts VAL-2026-1508 0003-00014574          (simulación)
 *   npx tsx scripts/vincular-envio-a-factura.ts VAL-2026-1508 0003-00014574 --apply
 */
import { prisma } from '@/lib/prisma'

const [quoteNumber, invoiceNumber] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const apply = process.argv.includes('--apply')

async function main() {
  if (!quoteNumber || !invoiceNumber) throw new Error('Uso: npx tsx scripts/vincular-envio-a-factura.ts <cotización> <factura> [--apply]')
  const quote = await prisma.quote.findUnique({
    where: { quoteNumber },
    select: { id: true, quoteNumber: true, status: true, customerId: true, salesPersonId: true, customer: { select: { name: true } } },
  })
  if (!quote) throw new Error(`No existe la cotización ${quoteNumber}`)
  const envios = await prisma.cotizacionFactura.findMany({
    where: { cotizacionId: quote.id, estado: 'BORRADOR' },
    select: { id: true, numeroFactura: true, colppyInvoiceId: true, invoiceId: true, montoUSD: true, fecha: true },
  })
  if (envios.length !== 1) throw new Error(`La cotización tiene ${envios.length} envíos en BORRADOR (se espera 1)`)
  const envio = envios[0]
  const borrador = envio.invoiceId
    ? await prisma.invoice.findUnique({
        where: { id: envio.invoiceId },
        select: { id: true, invoiceNumber: true, status: true, currency: true, notes: true, _count: { select: { items: true } } },
      })
    : null
  const real = await prisma.invoice.findFirst({
    where: { invoiceNumber, transactionType: 'SALE' },
    select: {
      id: true, invoiceNumber: true, status: true, currency: true, colppyId: true, customerId: true, emitidaPor: true, quoteId: true, userId: true,
      subtotal: true, issueDate: true,
      quote: { select: { quoteNumber: true, salesPersonId: true } },
      cotizacionFactura: { select: { id: true } },
      _count: { select: { items: true } },
    },
  })
  if (!real) throw new Error(`No existe la factura ${invoiceNumber} en el ERP`)

  // Validaciones: nada ambiguo
  const errores: string[] = []
  if (real.emitidaPor === 'ARCA') errores.push('la factura es del ERP (ARCA), no corresponde')
  if (!real.colppyId) errores.push('la factura no tiene id de Colppy')
  if (real.customerId !== quote.customerId) errores.push('la factura es de OTRO cliente que la cotización')
  if (real.cotizacionFactura && real.cotizacionFactura.id !== envio.id) errores.push('la factura ya está vinculada a otro envío')
  if (real._count.items > 0) errores.push(`la factura ya tiene ${real._count.items} ítems`)
  if (borrador && !borrador.invoiceNumber.startsWith('BORRADOR-COLPPY-')) errores.push(`el envío apunta a ${borrador.invoiceNumber}, que no es un borrador del ERP`)
  if (borrador && borrador.status !== 'DRAFT') errores.push(`el borrador del ERP está ${borrador.status}`)
  if (borrador && borrador.currency !== real.currency) errores.push(`monedas distintas (borrador ${borrador.currency}, factura ${real.currency})`)
  if (Math.abs(Number(real.subtotal) - Number(envio.montoUSD)) / Number(envio.montoUSD) > 0.02 && real.currency === 'USD') {
    errores.push(`el neto de la factura (${Number(real.subtotal)}) no coincide con el del envío (${Number(envio.montoUSD)})`)
  }

  console.log(`Cotización ${quote.quoteNumber} (${quote.status}) ${quote.customer.name}`)
  console.log(`  envío BORRADOR ${envio.numeroFactura} (Colppy ${envio.colppyInvoiceId}) USD ${Number(envio.montoUSD)} ${envio.fecha.toISOString().slice(0, 10)}`)
  console.log(`  borrador ERP: ${borrador ? `${borrador.invoiceNumber} ${borrador.status} ${borrador._count.items} ítems` : 'ninguno'}`)
  console.log(`  factura real: ${real.invoiceNumber} ${real.status} ${real.issueDate.toISOString().slice(0, 10)} ${real.currency} neto ${Number(real.subtotal)} (Colppy ${real.colppyId}) cotización actual ${real.quote?.quoteNumber ?? '-'}`)
  if (errores.length) {
    console.log('NO SE PUEDE VINCULAR:\n  - ' + errores.join('\n  - '))
    process.exitCode = 1
    return
  }
  console.log(`  → ítems del borrador a ${real.invoiceNumber}, borrador CANCELLED, envío → ${real.invoiceNumber} EMITIDA, factura → ${quote.quoteNumber}`)
  if (!apply) {
    console.log('SIMULACIÓN: no se cambió nada. Correr con --apply.')
    return
  }

  const systemUser = await prisma.user.findFirst({ select: { id: true } }) // default del sync
  await prisma.$transaction(async (tx) => {
    if (borrador) {
      await tx.invoiceItem.updateMany({ where: { invoiceId: borrador.id }, data: { invoiceId: real.id } })
      await tx.cotizacionFactura.update({ where: { id: envio.id }, data: { invoice: { disconnect: true } } })
      await tx.invoice.update({
        where: { id: borrador.id },
        data: { status: 'CANCELLED', notes: `${borrador.notes ? borrador.notes + '\n' : ''}Reemplazado por la factura real ${real.invoiceNumber} (vinculación manual).` },
      })
    }
    await tx.cotizacionFactura.update({
      where: { id: envio.id },
      data: { invoice: { connect: { id: real.id } }, colppyInvoiceId: real.colppyId, numeroFactura: real.invoiceNumber, estado: 'EMITIDA' },
    })
    const reemplazarVendedor = real.userId === systemUser?.id || (!!real.quote && real.userId === real.quote.salesPersonId)
    await tx.invoice.update({
      where: { id: real.id },
      data: { quoteId: quote.id, ...(reemplazarVendedor ? { userId: quote.salesPersonId } : {}) },
    })
    await tx.quoteStatusHistory.create({
      data: {
        quoteId: quote.id,
        fromStatus: quote.status,
        toStatus: quote.status,
        changedBy: quote.salesPersonId,
        notes: `Envío vinculado a la factura real ${real.invoiceNumber} (el borrador ${borrador?.invoiceNumber ?? ''} no existía en Colppy)`,
      },
    })
  })
  const despues = await prisma.invoice.findUnique({
    where: { id: real.id },
    select: { invoiceNumber: true, quote: { select: { quoteNumber: true } }, _count: { select: { items: true } }, cotizacionFactura: { select: { numeroFactura: true, estado: true } } },
  })
  console.log('APLICADO:', JSON.stringify(despues))
}

main()
  .catch((e) => { console.error('ERROR:', (e as Error).message); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())

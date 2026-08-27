/**
 * Arma los datos del PDF de una factura emitida por el ERP (ARCA) a partir de
 * la Invoice persistida. Reutilizable desde el endpoint de descarga y desde el
 * envío por email.
 */
import { prisma } from '@/lib/prisma'
import { isArcaConfigured, getArcaConfig } from '@/lib/arca/config'
import type { FacturaPDFData } from '@/lib/pdf/factura-generator'

const CONDICION_IVA_LABEL: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'IVA Responsable Inscripto',
  MONOTRIBUTO: 'Responsable Monotributo',
  EXENTO: 'IVA Sujeto Exento',
  CONSUMIDOR_FINAL: 'Consumidor Final',
  NO_RESPONSABLE: 'Sujeto No Categorizado',
  RESPONSABLE_NO_INSCRIPTO: 'Sujeto No Categorizado',
}

const DOC_LABEL: Record<number, string> = { 80: 'CUIT', 86: 'CUIL', 96: 'DNI', 99: '' }

function claseDe(cbteTipo: number): FacturaPDFData['clase'] {
  if ([3, 8, 13, 203, 208].includes(cbteTipo)) return 'NOTA DE CRÉDITO'
  if ([2, 7, 12, 202, 207].includes(cbteTipo)) return 'NOTA DE DÉBITO'
  return 'FACTURA'
}

function condicionVentaLabel(idCondicionPago: string | undefined): string {
  if (!idCondicionPago) return 'Cuenta Corriente'
  if (/contado/i.test(idCondicionPago)) return 'Contado'
  const m = idCondicionPago.match(/(\d+)/)
  if (m) return `Cuenta Corriente - ${m[1]} días`
  return idCondicionPago
}

export async function buildFacturaPdfData(invoiceId: string): Promise<FacturaPDFData | null> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: {
        select: {
          name: true,
          businessName: true,
          cuit: true,
          taxCondition: true,
          address: true,
          city: true,
          province: true,
        },
      },
      items: { include: { product: { select: { sku: true } } } },
      quote: { select: { quoteNumber: true, bonification: true } },
      relatedInvoice: { select: { invoiceType: true, pointOfSale: true, cbteNumero: true, cbteTipo: true, issueDate: true, invoiceNumber: true } },
    },
  })
  if (!inv || inv.emitidaPor !== 'ARCA' || !inv.cae || !inv.pointOfSale || !inv.cbteTipo || !inv.cbteNumero) {
    return null
  }

  const letra = (inv.invoiceType === 'A' || inv.invoiceType === 'B' || inv.invoiceType === 'C' ? inv.invoiceType : 'B') as 'A' | 'B' | 'C'
  const esA = letra === 'A'
  const subtotalNeto = Number(inv.subtotal)
  const taxAmount = Number(inv.taxAmount)
  const total = Number(inv.total)
  const payload = (inv.colppyPayload ?? null) as null | { idCondicionPago?: string; items?: Array<{ porcDesc?: number }> }
  const bonifPct = Number(inv.quote?.bonification ?? 0) || 0

  // Escala: las líneas se muestran de modo que sumen exactamente el neto (A) o
  // el total (B) de la cabecera, sea cual sea cómo se guardaron los precios
  // (con/sin IVA, con/sin bonificación).
  const sumLineas = inv.items.reduce((s, it) => s + Number(it.subtotal), 0)
  const objetivo = esA ? subtotalNeto : total
  const factor = sumLineas > 0 ? objetivo / sumLineas : 1
  const bonifFactor = 1 - bonifPct / 100

  const items: FacturaPDFData['items'] = inv.items.map((it) => {
    const subtotalLinea = Number(it.subtotal) * factor
    const cantidad = Number(it.quantity) || 1
    // Precio unitario PRE-bonificación (la bonif se muestra en su columna)
    const unitPost = subtotalLinea / cantidad
    const unitPre = bonifFactor > 0 ? unitPost / bonifFactor : unitPost
    return {
      codigo: it.sku || it.product?.sku || null,
      descripcion: it.description || '',
      detalle: inv.quote?.quoteNumber ? `Cotización ${inv.quote.quoteNumber}` : null,
      cantidad,
      unidad: 'Un',
      precioUnitario: Math.round(unitPre * 100) / 100,
      bonifPct: bonifPct || undefined,
      subtotal: Math.round(subtotalLinea * 100) / 100,
      alicuotaIva: Number(it.taxRate) || 21,
    }
  })

  const r = inv.customer
  const domicilio = [r.address, r.city, r.province].filter(Boolean).join(', ') || null

  return {
    letra,
    cbteTipo: inv.cbteTipo,
    clase: claseDe(inv.cbteTipo),
    puntoVenta: inv.pointOfSale,
    numero: inv.cbteNumero,
    fecha: inv.issueDate,
    fechaVencimiento: inv.dueDate,
    cae: inv.cae,
    caeVencimiento: inv.caeExpiration ?? inv.issueDate,
    qrUrl: inv.qrUrl ?? '',
    moneda: inv.currency === 'USD' ? 'USD' : 'ARS',
    cotizacion: inv.currency === 'USD' ? Number(inv.exchangeRate ?? 1) : 1,
    condicionVenta: condicionVentaLabel(payload?.idCondicionPago),
    referencia: inv.quote?.quoteNumber ? `Cotización ${inv.quote.quoteNumber}` : null,
    receptor: {
      nombre: r.businessName || r.name,
      docTipoLabel: DOC_LABEL[inv.docTipo ?? 80] ?? 'CUIT',
      docNro: inv.docNro || r.cuit || '',
      condicionIva: CONDICION_IVA_LABEL[r.taxCondition ?? ''] ?? 'Consumidor Final',
      domicilio,
    },
    items,
    totales: {
      netoGravado: subtotalNeto,
      netoNoGravado: 0,
      exento: 0,
      iva: [{ alicuota: 21, importe: taxAmount }],
      otrosTributos: 0,
      total,
    },
    asociados: inv.relatedInvoice && inv.relatedInvoice.pointOfSale && inv.relatedInvoice.cbteNumero
      ? [{
          descripcion: `Factura ${inv.relatedInvoice.invoiceType} ${String(inv.relatedInvoice.pointOfSale).padStart(4, '0')}-${String(inv.relatedInvoice.cbteNumero).padStart(8, '0')} del ${inv.relatedInvoice.issueDate.toLocaleDateString('es-AR')}`,
        }]
      : undefined,
    observaciones: inv.transactionType === 'CREDIT_NOTE' && inv.notes ? inv.notes.split('\n')[0].replace(/\. CAE .*$/, '') : null,
    isVoided: inv.status === 'CANCELLED',
    // FCE MiPyME: la factura (201/206) muestra vto de pago y CBU del emisor;
    // la NC/ND FCE solo cambia el título (el tipo ya viene en cbteTipo).
    fce: inv.cbteTipo === 201 || inv.cbteTipo === 206
      ? {
          vtoPago: inv.fceVtoPago,
          cbu: isArcaConfigured() ? getArcaConfig().cbu : null,
        }
      : undefined,
  }
}

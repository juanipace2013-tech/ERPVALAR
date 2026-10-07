/**
 * Arma los datos del PDF de una factura emitida por el ERP (ARCA) a partir de
 * la Invoice persistida. Reutilizable desde el endpoint de descarga y desde el
 * envío por email.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { isArcaConfigured, getArcaConfig } from '@/lib/arca/config'
import {
  FEX_CBTE,
  FEX_OPCIONAL,
  TIPO_PERSONA_LABEL,
  esCbteExportacion,
  infoCuitPais,
  isoDeDstPais,
} from '@/lib/arca/fex-params'
import { etiquetaIdFiscal, paisCliente } from '@/lib/cliente-exterior'
import type { FacturaPDFData } from '@/lib/pdf/factura-generator'
import { vincularLineasFactura } from '@/lib/facturacion/nc-unidades'

const CONDICION_IVA_LABEL: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'IVA Responsable Inscripto',
  MONOTRIBUTO: 'Responsable Monotributo',
  EXENTO: 'IVA Sujeto Exento',
  CONSUMIDOR_FINAL: 'Consumidor Final',
  NO_RESPONSABLE: 'Sujeto No Categorizado',
  RESPONSABLE_NO_INSCRIPTO: 'Sujeto No Categorizado',
  CLIENTE_EXTERIOR: 'Cliente del Exterior',
}

const DOC_LABEL: Record<number, string> = { 80: 'CUIT', 86: 'CUIL', 87: 'CDI', 96: 'DNI', 99: '' }

function claseDe(cbteTipo: number): FacturaPDFData['clase'] {
  if ([3, 8, 13, 203, 208, FEX_CBTE.NOTA_CREDITO_E].includes(cbteTipo)) return 'NOTA DE CRÉDITO'
  if ([2, 7, 12, 202, 207, FEX_CBTE.NOTA_DEBITO_E].includes(cbteTipo)) return 'NOTA DE DÉBITO'
  return 'FACTURA'
}

/** Condición que imprime la E en el bloque del receptor (y la banda de totales) */
export const LEYENDA_IVA_EXPORTACION = 'IVA Exento - Operación de Exportación'

function condicionVentaLabel(idCondicionPago: string | undefined): string {
  if (!idCondicionPago) return 'Cuenta Corriente'
  if (/contado/i.test(idCondicionPago)) return 'Contado'
  const m = idCondicionPago.match(/(\d+)/)
  if (m) return `Cuenta Corriente - ${m[1]} días`
  return idCondicionPago
}

/**
 * true si el ERP genera el PDF de ese tipo de comprobante: todos los que emite
 * (A/B/C, FCE MiPyME y, desde la letra E, los de exportación 19/20/21). Lo usan
 * la ficha de la factura y la emisión de la Factura E para ofrecer el link.
 */
export function soportaPdfFactura(cbteTipo: number | null | undefined): boolean {
  return typeof cbteTipo === 'number' && cbteTipo > 0
}

function cargarInvoicePdf(invoiceId: string) {
  return prisma.invoice.findUnique({
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
          colppyId: true,
          country: true,
          taxIdExterior: true,
        },
      },
      // En orden de creación: el mismo de las líneas del payload (ver lineasDelPdf)
      items: {
        orderBy: { id: 'asc' },
        include: {
          product: { select: { sku: true, name: true } },
          quoteItem: {
            select: {
              manualSku: true,
              description: true,
              product: { select: { sku: true, name: true } },
              additionals: { select: { description: true, product: { select: { sku: true, name: true } } } },
            },
          },
        },
      },
      quote: { select: { quoteNumber: true, bonification: true, purchaseOrderNumber: true } },
      relatedInvoice: { select: { invoiceType: true, pointOfSale: true, cbteNumero: true, cbteTipo: true, issueDate: true, invoiceNumber: true } },
      // Factura directa: la condición de pago está en el pedido (el payload de
      // Colppy recién existe cuando se registra en Colppy, después del PDF)
      facturaDirecta: { select: { pedido: true } },
    },
  })
}
type InvoicePdf = NonNullable<Awaited<ReturnType<typeof cargarInvoicePdf>>>

/** Datos de exportación de la E (FacturaExportacion: lo que se informó a ARCA) */
const SELECT_EXPORTACION_PDF = {
  desNumero: true,
  fobUSD: true,
  dstCmp: true,
  cuitPais: true,
  idImpositivo: true,
  domicilio: true,
  incoterm: true,
  incotermDs: true,
  formaPago: true,
  monedaCtz: true,
  obsComerciales: true,
  request: true,
} satisfies Prisma.FacturaExportacionSelect
type ExportacionPdfFila = Prisma.FacturaExportacionGetPayload<{ select: typeof SELECT_EXPORTACION_PDF }>

export async function buildFacturaPdfData(invoiceId: string): Promise<FacturaPDFData | null> {
  const inv = await cargarInvoicePdf(invoiceId)
  if (!inv || inv.emitidaPor !== 'ARCA' || !inv.cae || !inv.pointOfSale || !inv.cbteTipo || !inv.cbteNumero) {
    return null
  }
  if (!soportaPdfFactura(inv.cbteTipo)) return null

  // Factura/NC/ND E (WSFEX): armado propio a partir de lo que se informó a ARCA.
  // La tabla facturas_exportacion se consulta solo para estas.
  if (esCbteExportacion(inv.cbteTipo)) {
    const fex = await prisma.facturaExportacion.findUnique({ where: { invoiceId: inv.id }, select: SELECT_EXPORTACION_PDF })
    if (!fex) {
      // Sin los datos de exportación (DES, CUIT país, Incoterm) el PDF saldría
      // incompleto, y SharePoint no pisa un archivo ya subido: no se genera.
      logger.warn(`[Factura PDF] ${inv.invoiceNumber}: comprobante de exportación sin FacturaExportacion vinculada`)
      return null
    }
    return pdfDataExportacion({ ...inv, cbteTipo: inv.cbteTipo, pointOfSale: inv.pointOfSale, cbteNumero: inv.cbteNumero, cae: inv.cae }, fex)
  }

  const letra = (inv.invoiceType === 'A' || inv.invoiceType === 'B' || inv.invoiceType === 'C' ? inv.invoiceType : 'B') as 'A' | 'B' | 'C'
  const esA = letra === 'A'
  const subtotalNeto = Number(inv.subtotal)
  const taxAmount = Number(inv.taxAmount)
  const total = Number(inv.total)
  const payload = (inv.colppyPayload ?? null) as null | { idCondicionPago?: string; items?: Array<{ porcDesc?: number }> }
  const pedidoDirecta = (inv.facturaDirecta?.pedido ?? null) as null | { condicionPago?: string }
  const bonifPct = Number(inv.quote?.bonification ?? 0) || 0
  const referencia = referenciaDe(inv)

  // Escala: las líneas se muestran de modo que sumen exactamente el neto (A) o
  // el total (B) de la cabecera, sea cual sea cómo se guardaron los precios
  // (con/sin IVA, con/sin bonificación).
  const lineas = lineasDelPdf(inv)
  const sumLineas = lineas.reduce((s, l) => s + l.importe, 0)
  const objetivo = esA ? subtotalNeto : total
  const factor = sumLineas > 0 ? objetivo / sumLineas : 1
  const bonifFactor = 1 - bonifPct / 100

  const items: FacturaPDFData['items'] = lineas.map((l) => {
    const subtotalLinea = l.importe * factor
    const cantidad = l.cantidad
    // Precio unitario PRE-bonificación (la bonif se muestra en su columna)
    const unitPost = subtotalLinea / cantidad
    const unitPre = bonifFactor > 0 ? unitPost / bonifFactor : unitPost
    return {
      codigo: l.codigo,
      descripcion: l.descripcion,
      detalle: l.detalle,
      cantidad,
      unidad: 'Un',
      precioUnitario: Math.round(unitPre * 100) / 100,
      bonifPct: bonifPct || undefined,
      subtotal: Math.round(subtotalLinea * 100) / 100,
      alicuotaIva: l.alicuota,
    }
  })

  const r = inv.customer
  const domicilio = [r.address, r.city, r.province].filter(Boolean).join(', ') || null
  // Sin condición conocida el receptor va como consumidor final (= receptorDesdeCondicion)
  const condicionIva = CONDICION_IVA_LABEL[r.taxCondition ?? ''] ?? 'Consumidor Final'

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
    condicionVenta: condicionVentaLabel(payload?.idCondicionPago ?? pedidoDirecta?.condicionPago),
    referencia,
    receptor: {
      nombre: r.businessName || r.name,
      docTipoLabel: DOC_LABEL[inv.docTipo ?? 80] ?? 'CUIT',
      docNro: inv.docNro || r.cuit || '',
      condicionIva,
      domicilio,
      // Leyenda "A CONSUMIDOR FINAL" (RG 5824/2026) en los datos del receptor
      consumidorFinal: !esA && condicionIva === CONDICION_IVA_LABEL.CONSUMIDOR_FINAL,
    },
    items,
    totales: {
      netoGravado: subtotalNeto,
      netoNoGravado: 0,
      exento: 0,
      iva: [{ alicuota: 21, importe: taxAmount }],
      otrosTributos: 0,
      // El ERP no factura impuestos internos ni otros nacionales indirectos
      otrosImpNacionalesIndirectos: 0,
      total,
    },
    asociados: asociadosDe(inv),
    observaciones: observacionNcDe(inv),
    isVoided: inv.status === 'CANCELLED',
    // FCE MiPyME: la factura (201/206) muestra vto de pago y CBU del emisor;
    // la NC/ND FCE solo cambia el título (el tipo ya viene en cbteTipo).
    fce: inv.cbteTipo === 201 || inv.cbteTipo === 206
      ? {
          vtoPago: inv.fceVtoPago,
          cbu: isArcaConfigured() ? getArcaConfig().cbu : null,
        }
      : undefined,
    // CBU de VAL ARG (ARCA_CBU, cuenta Galicia) en el encabezado de todas las facturas
    cbuEmisor: isArcaConfigured() ? getArcaConfig().cbu ?? null : null,
    // Fila OC / Cliente Nro / Remito (estilo Winters)
    ordenCompra: inv.quote?.purchaseOrderNumber ?? null,
    clienteNro: inv.customer.colppyId ?? null,
    // El nro de remito queda en las notas al emitir ("Remito: XXXX-XXXXXXXX")
    remito: remitoDe(inv),
  }
}

type LineaPdf = { codigo: string | null; descripcion: string; detalle: string | null; cantidad: number; importe: number; alicuota: number }

/**
 * Renglones del PDF. El InvoiceItem guarda la electroválvula con sus adicionales
 * (bobina, conector…) en un solo renglón con el precio combinado, pero a
 * ARCA/Colppy fue un renglón por artículo (buildSplitItem). Si el payload tiene
 * más renglones que la factura y todos se vinculan a un ítem, el PDF sale con
 * esos renglones (como el remito y Colppy); si no, con los de la factura.
 * `importe` es pre-bonificación y en la base del payload (neto en la A, final en
 * la B): el llamador lo escala a la cabecera.
 */
function lineasDelPdf(inv: InvoicePdf): LineaPdf[] {
  const base: LineaPdf[] = inv.items.map((it) => ({
    codigo: it.sku || it.product?.sku || null,
    descripcion: it.description || '',
    detalle: it.comment || null,
    cantidad: Number(it.quantity) || 1,
    importe: Number(it.subtotal),
    alicuota: Number(it.taxRate) || 21,
  }))
  const payload = (inv.colppyPayload ?? null) as null | { items?: Array<{ Descripcion?: string | null; Cantidad?: unknown; ImporteUnitario?: unknown }> }
  const lineasPayload = Array.isArray(payload?.items) ? payload!.items! : null
  if (!lineasPayload || lineasPayload.length <= inv.items.length) return base
  if (new Set(base.map((l) => l.alicuota)).size !== 1) return base

  const vinculos = vincularLineasFactura(
    lineasPayload,
    inv.items.map((it) => ({
      id: it.id,
      quoteItemId: it.quoteItemId,
      quantity: Number(it.quantity),
      codigos: [it.sku, it.product?.sku, it.quoteItem?.product?.sku, it.quoteItem?.manualSku],
      nombres: [it.description, it.product?.name, it.quoteItem?.description, it.quoteItem?.product?.name],
      adicionales: (it.quoteItem?.additionals ?? []).map((a) => ({ codigos: [a.product?.sku], nombres: [a.product?.name, a.description] })),
    }))
  )
  if (vinculos.some((v) => !v)) return base

  const porId = new Map(inv.items.map((it, i) => [it.id, { it, linea: base[i] }]))
  const adicionalesUsados = new Map<string, number>()
  return lineasPayload.map((l, i) => {
    const v = vinculos[i]!
    const { it, linea } = porId.get(v.invoiceItemId)!
    const cantidad = Number(l.Cantidad) || 1
    const importe = Math.round(cantidad * (Number(l.ImporteUnitario) || 0) * 100) / 100
    if (!v.adicional) return { ...linea, cantidad, importe }
    // Adicional: el de igual nombre o, si no, el siguiente en orden
    const adds = it.quoteItem?.additionals ?? []
    const desc = (l.Descripcion ?? '').trim().toUpperCase()
    const k = adicionalesUsados.get(it.id) ?? 0
    adicionalesUsados.set(it.id, k + 1)
    const add = adds.find((a) => !!desc && [a.product?.name, a.description].some((n) => (n ?? '').trim().toUpperCase() === desc)) ?? adds[k]
    return {
      codigo: add?.product?.sku || null,
      descripcion: l.Descripcion || add?.product?.name || add?.description || '',
      detalle: null,
      cantidad,
      importe,
      alicuota: linea.alicuota,
    }
  })
}

/** "Cotización VAL-..." o, en ventas de Mercado Libre facturadas desde el ERP (sin cotización), la venta */
function referenciaDe(inv: InvoicePdf): string | null {
  const ventaMl = inv.notes?.match(/Venta Mercado Libre #(\d+)/)?.[1]
  return inv.quote?.quoteNumber
    ? `Cotización ${inv.quote.quoteNumber}`
    : ventaMl
      ? `Mercado Libre - Venta #${ventaMl}`
      : null
}

/** Comprobante asociado (NC/ND): "Factura A 0007-00000003 del 1/10/2026" */
function asociadosDe(inv: InvoicePdf): FacturaPDFData['asociados'] {
  const rel = inv.relatedInvoice
  return rel && rel.pointOfSale && rel.cbteNumero
    ? [{
        descripcion: `Factura ${rel.invoiceType} ${String(rel.pointOfSale).padStart(4, '0')}-${String(rel.cbteNumero).padStart(8, '0')} del ${rel.issueDate.toLocaleDateString('es-AR')}`,
      }]
    : undefined
}

/** Motivo de la NC (primera línea de las notas, sin el CAE) */
function observacionNcDe(inv: InvoicePdf): string | null {
  return inv.transactionType === 'CREDIT_NOTE' && inv.notes ? inv.notes.split('\n')[0].replace(/\. CAE .*$/, '') : null
}

function remitoDe(inv: InvoicePdf): string | null {
  return inv.notes?.match(/Remito:\s*((?:RE\s*)?[\w-]+)/)?.[1] ?? null
}

/**
 * PDF de un comprobante de exportación (letra E, plan Factura E, sección 8).
 * Todo sale de lo que se informó a ARCA (FacturaExportacion y su Cmp), no del
 * cliente actual: si después se edita el cliente, el PDF no cambia.
 * - Receptor: Cliente y Domicilio_cliente del Cmp, CUIT país (con país y tipo
 *   de persona), ID fiscal del exterior (RUT, RUC...), destino y divisa.
 * - Ítems: precio USD antes de la bonificación, Dto % y total neto, tal cual se
 *   guardaron (1 a 1 con los Items del Cmp, flete manual incluido). Sin IVA.
 * - Forma de pago e Incoterm de la emisión; TC oficial de ARCA (Moneda_ctz).
 * - Exporta Simple: N° de DES (2401) y FOB (2402) para la leyenda.
 * - Sin CBU: es una cuenta en pesos de un banco argentino, no le sirve a un
 *   cliente del exterior.
 */
function pdfDataExportacion(inv: InvoicePdf & { cbteTipo: number; pointOfSale: number; cbteNumero: number; cae: string }, fex: ExportacionPdfFila): FacturaPDFData {
  const cmp = (fex.request ?? {}) as { Cliente?: string; Opcionales?: Array<{ Id?: string; Valor?: string }> }
  const opcional = (id: string) => cmp.Opcionales?.find((o) => o.Id === id)?.Valor ?? null
  const r = inv.customer
  const total = Number(inv.total)

  const iso = isoDeDstPais(fex.dstCmp)
  const pais = (iso && paisCliente(iso)?.nombre) || paisCliente(r.country)?.nombre || r.country || ''
  const cuitPais = infoCuitPais(fex.cuitPais)
  const cuitPaisDetalle = cuitPais
    ? `${(paisCliente(cuitPais.iso)?.nombre ?? cuitPais.iso).toUpperCase()} - ${TIPO_PERSONA_LABEL[cuitPais.tipoPersona]}`
    : null

  const desNumero = opcional(FEX_OPCIONAL.DES) ?? fex.desNumero
  const fobFactura = opcional(FEX_OPCIONAL.FOB_DES)
  const fobDes = fex.fobUSD === null ? null : Number(fex.fobUSD)

  const items: FacturaPDFData['items'] = inv.items.map((it) => ({
    codigo: it.sku || it.product?.sku || null,
    descripcion: it.description || '',
    detalle: it.comment || null,
    cantidad: Number(it.quantity) || 1,
    unidad: 'Un',
    precioUnitario: Number(it.unitPrice),
    bonifPct: Number(it.discount) || undefined,
    subtotal: Number(it.subtotal),
    alicuotaIva: 0,
  }))

  const observaciones = [fex.obsComerciales?.trim() || null, observacionNcDe(inv)].filter(Boolean).join(' · ') || null

  return {
    letra: 'E',
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
    cotizacion: Number(fex.monedaCtz),
    condicionVenta: fex.formaPago?.trim() || '-',
    referencia: referenciaDe(inv),
    observaciones,
    receptor: {
      nombre: cmp.Cliente?.trim() || r.businessName || r.name,
      docTipoLabel: (iso && paisCliente(iso)?.idFiscal) || etiquetaIdFiscal(r.country),
      docNro: fex.idImpositivo ?? '',
      condicionIva: LEYENDA_IVA_EXPORTACION,
      domicilio: fex.domicilio,
    },
    items,
    totales: {
      netoGravado: 0,
      netoNoGravado: 0,
      exento: total,
      iva: [],
      otrosTributos: 0,
      total,
    },
    asociados: asociadosDe(inv),
    isVoided: inv.status === 'CANCELLED',
    cbuEmisor: null,
    ordenCompra: inv.quote?.purchaseOrderNumber ?? null,
    clienteNro: r.colppyId ?? null,
    remito: remitoDe(inv),
    exportacion: {
      destino: pais.toUpperCase(),
      cuitPais: fex.cuitPais,
      cuitPaisDetalle,
      divisa: inv.currency === 'USD' ? 'USD - Dólar Estadounidense' : 'ARS - Peso Argentino',
      incoterm: fex.incoterm,
      incotermLugar: fex.incotermDs,
      tipoCambioArca: Number(fex.monedaCtz),
      exportaSimple: desNumero
        ? { desNumero, fobDesUSD: fobDes, fobFacturaUSD: fobFactura === null ? fobDes : Number(fobFactura) }
        : null,
    },
  }
}

import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * PDF de la Factura E (letra E, plan Factura E sección 8): datos que arma
 * buildFacturaPdfData a partir de la Invoice + FacturaExportacion, nombre del
 * archivo (mismo que usa SharePoint) y el PDF generado. Con Prisma falso.
 *
 * Datos de PRUEBA: domicilio, RUT, N° de DES (el ejemplo del manual),
 * cotización y el flete de USD 120 (el flete real todavía no se conoce).
 */

const db = vi.hoisted(() => ({
  invoice: { findUnique: vi.fn() },
  facturaExportacion: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { LEYENDA_IVA_EXPORTACION, buildFacturaPdfData, soportaPdfFactura } from '@/lib/facturacion/factura-pdf-data'
import {
  facturaPdfFilename,
  generateFacturaPDF,
  importeEnLetrasUsd,
  leyendaExportaSimple,
  tituloComprobante,
} from '@/lib/pdf/factura-generator'
import { infoCuitPais, isoDeDstPais } from '@/lib/arca/fex-params'
import { logger } from '@/lib/logger'

/** Factura E 0010-00000001 tal como la guarda registrarInvoiceExportacion (Decimal → number) */
function invoiceE(over: Record<string, unknown> = {}) {
  return {
    id: 'inv-e1',
    invoiceNumber: 'E-0010-00000001',
    invoiceType: 'E',
    transactionType: 'SALE',
    emitidaPor: 'ARCA',
    status: 'AUTHORIZED',
    cae: '76543210987654',
    caeExpiration: new Date('2026-10-15T15:00:00Z'),
    pointOfSale: 10,
    cbteTipo: 19,
    cbteNumero: 1,
    issueDate: new Date('2026-10-05T13:00:00Z'),
    dueDate: new Date('2026-10-05T13:00:00Z'),
    currency: 'USD',
    exchangeRate: 1450.5,
    subtotal: 2198.88,
    taxAmount: 0,
    total: 2198.88,
    docTipo: null,
    docNro: '76.123.456-7',
    qrUrl: 'https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjF9',
    notes: 'Factura E E-0010-00000001 (exportación) emitida por el ERP (ARCA WSFEX). PENDIENTE de cargar a mano en Colppy.',
    colppyPayload: null,
    fceVtoPago: null,
    customer: {
      name: 'CLAUGER CHILE SPA',
      businessName: 'CLAUGER CHILE SPA',
      cuit: 'CL-761234567',
      taxCondition: 'CLIENTE_EXTERIOR',
      address: 'Av. Ejemplo 1234',
      city: 'Santiago',
      province: null,
      colppyId: null,
      country: 'Chile',
      taxIdExterior: '76.123.456-7',
    },
    items: [
      {
        sku: '2228 12',
        description: 'Válvula GENEBRE art. 2228 12',
        comment: null,
        quantity: 3,
        unitPrice: 692.96,
        discount: 0,
        subtotal: 2078.88,
        taxRate: 0,
        product: { sku: '2228 12' },
      },
      // Línea manual de flete (dato de prueba)
      {
        sku: null,
        description: 'Flete internacional',
        comment: null,
        quantity: 1,
        unitPrice: 120,
        discount: 0,
        subtotal: 120,
        taxRate: 0,
        product: null,
      },
    ],
    quote: { quoteNumber: 'VAL-2026-3507', bonification: 0, purchaseOrderNumber: '90855-196-049' },
    relatedInvoice: null,
    ...over,
  }
}

/** FacturaExportacion vinculada (lo que se informó a ARCA) */
function filaExportacion(over: Record<string, unknown> = {}) {
  return {
    desNumero: '2133ECSI12',
    fobUSD: 2078.88,
    dstCmp: 208,
    cuitPais: '55000000034',
    idImpositivo: '76.123.456-7',
    domicilio: 'Av. Ejemplo 1234, Santiago, Chile',
    incoterm: 'CPT',
    incotermDs: 'Santiago',
    formaPago: 'Transferencia anticipada 100%',
    monedaCtz: 1450.5,
    obsComerciales: 'OC 90855-196-049',
    request: {
      Cliente: 'CLAUGER CHILE SPA',
      Opcionales: [
        { Id: '2401', Valor: '2133ECSI12' },
        { Id: '2402', Valor: '2078.88' },
      ],
    },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.invoice.findUnique.mockResolvedValue(invoiceE())
  db.facturaExportacion.findUnique.mockResolvedValue(filaExportacion())
})

describe('PDF de la Factura E: datos', () => {
  it('letra E, código 19, receptor del exterior y sin IVA', async () => {
    const d = await buildFacturaPdfData('inv-e1')
    expect(d).not.toBeNull()
    if (!d) return
    expect(db.facturaExportacion.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { invoiceId: 'inv-e1' } }))
    expect(d.letra).toBe('E')
    expect(d.cbteTipo).toBe(19)
    expect(d.clase).toBe('FACTURA')
    expect(d.puntoVenta).toBe(10)
    expect(d.numero).toBe(1)
    expect(d.moneda).toBe('USD')
    expect(d.cotizacion).toBe(1450.5)

    expect(d.receptor).toEqual({
      nombre: 'CLAUGER CHILE SPA',
      docTipoLabel: 'RUT',
      docNro: '76.123.456-7',
      condicionIva: LEYENDA_IVA_EXPORTACION,
      domicilio: 'Av. Ejemplo 1234, Santiago, Chile',
    })
    // Sin filas de IVA: toda la operación es exenta
    expect(d.totales).toEqual({ netoGravado: 0, netoNoGravado: 0, exento: 2198.88, iva: [], otrosTributos: 0, total: 2198.88 })
    expect(d.items.map((i) => i.alicuotaIva)).toEqual([0, 0])
  })

  it('ítems tal como se informaron a ARCA (precio USD, Dto %, flete manual incluido)', async () => {
    const d = (await buildFacturaPdfData('inv-e1'))!
    expect(d.items).toEqual([
      expect.objectContaining({ codigo: '2228 12', cantidad: 3, precioUnitario: 692.96, bonifPct: undefined, subtotal: 2078.88 }),
      expect.objectContaining({ codigo: null, descripcion: 'Flete internacional', cantidad: 1, precioUnitario: 120, subtotal: 120 }),
    ])
    expect(d.items.reduce((s, i) => s + i.subtotal, 0)).toBeCloseTo(d.totales.total, 2)
  })

  it('con bonificación: precio antes del descuento y Dto % de la línea', async () => {
    db.invoice.findUnique.mockResolvedValue(
      invoiceE({
        total: 1870.99,
        subtotal: 1870.99,
        items: [
          { sku: '2228 12', description: 'Válvula', comment: null, quantity: 3, unitPrice: 692.96, discount: 10, subtotal: 1870.99, taxRate: 0, product: null },
        ],
      })
    )
    const d = (await buildFacturaPdfData('inv-e1'))!
    expect(d.items[0]).toEqual(expect.objectContaining({ precioUnitario: 692.96, bonifPct: 10, subtotal: 1870.99 }))
  })

  it('exportación: CUIT país con país y tipo de persona, destino, divisa, Incoterm, forma de pago y DES/FOB', async () => {
    const d = (await buildFacturaPdfData('inv-e1'))!
    expect(d.exportacion).toEqual({
      destino: 'CHILE',
      cuitPais: '55000000034',
      cuitPaisDetalle: 'CHILE - Persona Jurídica',
      divisa: 'USD - Dólar Estadounidense',
      incoterm: 'CPT',
      incotermLugar: 'Santiago',
      tipoCambioArca: 1450.5,
      exportaSimple: { desNumero: '2133ECSI12', fobDesUSD: 2078.88, fobFacturaUSD: 2078.88 },
    })
    expect(d.condicionVenta).toBe('Transferencia anticipada 100%')
    expect(d.referencia).toBe('Cotización VAL-2026-3507')
    expect(d.ordenCompra).toBe('90855-196-049')
    expect(d.observaciones).toBe('OC 90855-196-049')
    // El CBU (cuenta en pesos) no le sirve a un cliente del exterior
    expect(d.cbuEmisor).toBeNull()
    expect(d.fce).toBeUndefined()
  })

  it('sale de lo informado a ARCA, no del cliente actual', async () => {
    db.invoice.findUnique.mockResolvedValue(
      invoiceE({ customer: { ...invoiceE().customer, businessName: 'OTRO NOMBRE', address: 'Otra calle 1', taxIdExterior: '99.999.999-9' } })
    )
    const d = (await buildFacturaPdfData('inv-e1'))!
    expect(d.receptor.nombre).toBe('CLAUGER CHILE SPA')
    expect(d.receptor.domicilio).toBe('Av. Ejemplo 1234, Santiago, Chile')
    expect(d.receptor.docNro).toBe('76.123.456-7')
  })

  it('sin RUT: va solo el CUIT país', async () => {
    db.facturaExportacion.findUnique.mockResolvedValue(filaExportacion({ idImpositivo: null }))
    const d = (await buildFacturaPdfData('inv-e1'))!
    expect(d.receptor.docNro).toBe('')
    expect(d.exportacion?.cuitPais).toBe('55000000034')
  })

  it('sin la FacturaExportacion vinculada no hay PDF (saldría sin DES ni CUIT país)', async () => {
    db.facturaExportacion.findUnique.mockResolvedValue(null)
    expect(await buildFacturaPdfData('inv-e1')).toBeNull()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('NC E (21): clase nota de crédito y comprobante asociado', async () => {
    db.invoice.findUnique.mockResolvedValue(
      invoiceE({
        cbteTipo: 21,
        cbteNumero: 1,
        invoiceNumber: 'NCE-0010-00000001',
        transactionType: 'CREDIT_NOTE',
        notes: 'Devolución de 1 válvula. CAE 123',
        relatedInvoice: { invoiceType: 'E', pointOfSale: 10, cbteNumero: 1, cbteTipo: 19, issueDate: new Date('2026-10-05T13:00:00Z'), invoiceNumber: 'E-0010-00000001' },
      })
    )
    const d = (await buildFacturaPdfData('inv-e1'))!
    expect(d.clase).toBe('NOTA DE CRÉDITO')
    expect(d.asociados?.[0].descripcion).toMatch(/^Factura E 0010-00000001 del /)
    expect(d.observaciones).toBe('OC 90855-196-049 · Devolución de 1 válvula')
    expect(facturaPdfFilename(d)).toBe('Nota de Credito E 0010-00000001 CLAUGER CHILE SPA.pdf')
  })

  it('una Factura B sigue igual y no consulta facturas_exportacion', async () => {
    db.invoice.findUnique.mockResolvedValue(
      invoiceE({
        invoiceType: 'B',
        cbteTipo: 6,
        pointOfSale: 7,
        cbteNumero: 12,
        invoiceNumber: 'B-0007-00000012',
        currency: 'ARS',
        exchangeRate: null,
        subtotal: 1000,
        taxAmount: 210,
        total: 1210,
        docTipo: 96,
        docNro: '30111222',
        customer: { ...invoiceE().customer, taxCondition: 'CONSUMIDOR_FINAL', country: 'Argentina', taxIdExterior: null },
        items: [{ sku: 'X1', description: 'Item', comment: null, quantity: 1, unitPrice: 1210, discount: 0, subtotal: 1210, taxRate: 21, product: null }],
      })
    )
    const d = (await buildFacturaPdfData('inv-b'))!
    expect(db.facturaExportacion.findUnique).not.toHaveBeenCalled()
    expect(d.letra).toBe('B')
    expect(d.exportacion).toBeUndefined()
    expect(d.totales.iva).toEqual([{ alicuota: 21, importe: 210 }])
    expect(d.receptor.docTipoLabel).toBe('DNI')
  })

  it('soportaPdfFactura: todos los comprobantes del ERP, incluida la E', () => {
    expect(soportaPdfFactura(19)).toBe(true)
    expect(soportaPdfFactura(21)).toBe(true)
    expect(soportaPdfFactura(1)).toBe(true)
    expect(soportaPdfFactura(null)).toBe(false)
  })
})

describe('PDF de la Factura E: nombre y textos', () => {
  it('nombre de archivo (el mismo que se sube a SharePoint)', async () => {
    const d = (await buildFacturaPdfData('inv-e1'))!
    expect(facturaPdfFilename(d)).toBe('Factura E 0010-00000001 CLAUGER CHILE SPA.pdf')
  })

  it('título "de Exportación" (los demás no cambian)', () => {
    expect(tituloComprobante({ clase: 'FACTURA', cbteTipo: 19 })).toBe('Factura de Exportación')
    expect(tituloComprobante({ clase: 'NOTA DE CRÉDITO', cbteTipo: 21 })).toBe('Nota de Crédito de Exportación')
    expect(tituloComprobante({ clase: 'NOTA DE DÉBITO', cbteTipo: 20 })).toBe('Nota de Débito de Exportación')
    expect(tituloComprobante({ clase: 'FACTURA', cbteTipo: 1 })).toBe('Factura')
    expect(tituloComprobante({ clase: 'FACTURA', cbteTipo: 201 })).toBe('Factura de Crédito MiPyME')
  })

  it('importe en letras en dólares estadounidenses', () => {
    expect(importeEnLetrasUsd(2198.88)).toBe('dos mil ciento noventa y ocho dólares estadounidenses con 88/100')
    expect(importeEnLetrasUsd(2078.88)).toBe('dos mil setenta y ocho dólares estadounidenses con 88/100')
    expect(importeEnLetrasUsd(1)).toBe('un dólar estadounidense')
    expect(importeEnLetrasUsd(21.5)).toBe('veintiún dólares estadounidenses con 50/100')
    expect(importeEnLetrasUsd(31)).toBe('treinta y un dólares estadounidenses')
    expect(importeEnLetrasUsd(1_000_000)).toBe('un millón de dólares estadounidenses')
    expect(importeEnLetrasUsd(0.1 + 0.2)).toBe('cero dólares estadounidenses con 30/100')
  })

  it('leyenda de Exporta Simple con el N° de DES y los FOB', () => {
    expect(leyendaExportaSimple({ desNumero: '2133ECSI12', fobDesUSD: 2078.88, fobFacturaUSD: 2078.88 })).toEqual([
      'Régimen de Exportación Simplificada (Exporta Simple)',
      'Documento de Exportación Simplificada N° 2133ECSI12',
      'Monto FOB DES: USD 2.078,88 - Monto FOB en esta factura: USD 2.078,88',
    ])
  })

  it('CUIT país y código de destino de vuelta a país / tipo de persona', () => {
    expect(infoCuitPais('55000000034')).toEqual({ iso: 'CL', tipoPersona: 'JURIDICA' })
    expect(infoCuitPais('50000000016')).toEqual({ iso: 'UY', tipoPersona: 'FISICA' })
    expect(infoCuitPais('12345678901')).toBeNull()
    expect(infoCuitPais(null)).toBeNull()
    expect(isoDeDstPais(208)).toBe('CL')
    expect(isoDeDstPais(999)).toBeNull()
  })
})

describe('PDF de la Factura E: generación', () => {
  /** Texto de los streams del PDF (jsPDF no comprime por default) */
  const textoPdf = (buf: Buffer) => buf.toString('latin1')

  it('genera el PDF con la letra E, el receptor del exterior y la leyenda de Exporta Simple', async () => {
    const d = (await buildFacturaPdfData('inv-e1'))!
    const pdf = await generateFacturaPDF(d)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    const t = textoPdf(pdf)
    expect(t).toContain('FACTURA DE EXPORTACI')
    expect(t).toContain('COD.19')
    // jsPDF escapa los paréntesis en el stream: "\("
    expect(t).toContain('55000000034 \\(CHILE - Persona Jurídica\\)')
    expect(t).toContain('RUT: 76.123.456-7')
    expect(t).toContain('IVA Exento - Operaci')
    expect(t).toContain('2133ECSI12')
    expect(t).toContain('Tipo de cambio ARCA:')
    expect(t).toContain('CPT Santiago')
    expect(t).toContain('ESTADOUNIDENSES')
    // Sin la banda de transparencia fiscal ni el IVA contenido de la B
    expect(t).not.toContain('Transparencia Fiscal')
    expect(t).not.toContain('IVA Contenido')
    expect(t).not.toContain('Otros Impuestos Nacionales Indirectos')
    expect(t).not.toContain('A CONSUMIDOR FINAL')
  })

  it('una Factura B conserva la banda de transparencia fiscal', async () => {
    db.invoice.findUnique.mockResolvedValue(
      invoiceE({
        invoiceType: 'B',
        cbteTipo: 6,
        pointOfSale: 7,
        currency: 'ARS',
        exchangeRate: null,
        total: 1210,
        subtotal: 1000,
        taxAmount: 210,
        customer: { ...invoiceE().customer, taxCondition: 'CONSUMIDOR_FINAL', country: 'Argentina' },
      })
    )
    const t = textoPdf(await generateFacturaPDF((await buildFacturaPdfData('inv-b'))!))
    expect(t).toContain('Transparencia Fiscal')
    // RG 5614: IVA contenido y otros impuestos nacionales indirectos
    expect(t).toContain('IVA Contenido')
    expect(t).toContain('Otros Impuestos Nacionales Indirectos')
    expect(t).not.toContain('Exportaci')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * PDF de la Factura B a consumidor final (ventas de Mercado Libre):
 *  - banda del Régimen de Transparencia Fiscal (RG 5614): IVA Contenido y Otros
 *    Impuestos Nacionales Indirectos (0,00 si no hay); también en la A;
 *  - documento del receptor: CUIL con guiones como el CUIT, DNI tal cual;
 *  - leyenda "A CONSUMIDOR FINAL" (RG 5824/2026) en los datos del receptor;
 *  - descripción sin el código adelante (regex de separadores corregida).
 * Prisma falso; el PDF se genera de verdad (jsPDF) y se revisa su texto.
 */

const db = vi.hoisted(() => ({
  invoice: { findUnique: vi.fn() },
  facturaExportacion: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { buildFacturaPdfData } from '@/lib/facturacion/factura-pdf-data'
import {
  LEYENDA_CONSUMIDOR_FINAL,
  descripcionSinCodigo,
  documentoReceptorPdf,
  generateFacturaPDF,
} from '@/lib/pdf/factura-generator'

/** Factura B 0007-00000012 de una venta de ML a un consumidor final con CUIL (datos inventados) */
function invoiceB(over: Record<string, unknown> = {}) {
  return {
    id: 'inv-b1',
    invoiceNumber: 'B-0007-00000012',
    invoiceType: 'B',
    transactionType: 'SALE',
    emitidaPor: 'ARCA',
    status: 'AUTHORIZED',
    cae: '76000000000012',
    caeExpiration: new Date('2026-10-15T15:00:00Z'),
    pointOfSale: 7,
    cbteTipo: 6,
    cbteNumero: 12,
    issueDate: new Date('2026-10-05T13:00:00Z'),
    dueDate: new Date('2026-10-05T13:00:00Z'),
    currency: 'ARS',
    exchangeRate: null,
    subtotal: 82.64,
    taxAmount: 17.36,
    total: 100,
    docTipo: 86,
    docNro: '20123456786',
    qrUrl: 'https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjF9',
    notes: 'Venta Mercado Libre #2000009000000001. Emitida por el ERP (ARCA).',
    colppyPayload: { idCondicionPago: 'Contado' },
    fceVtoPago: null,
    customer: {
      name: 'PEREZ JUAN',
      businessName: 'PEREZ JUAN',
      cuit: '20-12345678-6',
      taxCondition: 'CONSUMIDOR_FINAL',
      address: 'SAN MARTIN 100',
      city: 'ROSARIO',
      province: 'Santa Fe',
      colppyId: '900',
      country: 'Argentina',
      taxIdExterior: null,
    },
    items: [
      { sku: 'V1', description: 'V1 - Válvula esférica 1"', comment: null, quantity: 1, unitPrice: 100, discount: 0, subtotal: 100, taxRate: 21, product: { sku: 'V1' } },
    ],
    quote: null,
    relatedInvoice: null,
    ...over,
  }
}

/** Texto de los streams del PDF (jsPDF no comprime por default) */
const textoPdf = (buf: Buffer) => buf.toString('latin1')

async function pdfDe(inv: Record<string, unknown>) {
  db.invoice.findUnique.mockResolvedValue(inv)
  const data = (await buildFacturaPdfData(String(inv.id)))!
  return { data, texto: textoPdf(await generateFacturaPDF(data)) }
}

beforeEach(() => vi.clearAllMocks())

describe('PDF Factura B a consumidor final', () => {
  it('CUIL: con guiones y etiqueta CUIL; leyenda A CONSUMIDOR FINAL; banda con IVA contenido y otros impuestos', async () => {
    const { data, texto } = await pdfDe(invoiceB())
    expect(data.receptor).toMatchObject({ docTipoLabel: 'CUIL', docNro: '20123456786', condicionIva: 'Consumidor Final', consumidorFinal: true })
    expect(data.totales.otrosImpNacionalesIndirectos).toBe(0)
    expect(texto).toContain('CUIL: 20-12345678-6')
    expect(texto).toContain(LEYENDA_CONSUMIDOR_FINAL)
    // jsPDF escapa los paréntesis en el stream: "\("
    expect(texto).toContain('Régimen de Transparencia Fiscal al Consumidor \\(Ley 27.743\\)')
    expect(texto).toContain('IVA Contenido')
    expect(texto).toContain('Otros Impuestos Nacionales Indirectos')
    expect(texto).toContain('17,36')
    // Total = precio final
    expect(texto).toContain('100,00')
  })

  it('CDI (DocTipo 87): etiqueta CDI con guiones como el CUIT', async () => {
    const { data, texto } = await pdfDe(invoiceB({ docTipo: 87, docNro: '20123456786' }))
    expect(data.receptor.docTipoLabel).toBe('CDI')
    expect(texto).toContain('CDI: 20-12345678-6')
  })

  it('DNI: "DNI: n" sin formato de CUIT', async () => {
    const { data, texto } = await pdfDe(invoiceB({ docTipo: 96, docNro: '12345678' }))
    expect(data.receptor.docTipoLabel).toBe('DNI')
    expect(texto).toContain('DNI: 12345678')
    expect(texto).toContain(LEYENDA_CONSUMIDOR_FINAL)
  })

  it('B a un exento: sin la leyenda de consumidor final', async () => {
    const { data, texto } = await pdfDe(invoiceB({ docTipo: 80, docNro: '30700000008', customer: { ...invoiceB().customer, taxCondition: 'EXENTO', cuit: '30-70000000-8' } }))
    expect(data.receptor.consumidorFinal).toBe(false)
    expect(texto).toContain('CUIT: 30-70000000-8')
    expect(texto).not.toContain(LEYENDA_CONSUMIDOR_FINAL)
    expect(texto).toContain('Otros Impuestos Nacionales Indirectos')
  })

  it('Factura A: sin la leyenda; la banda de transparencia también suma la segunda línea', async () => {
    const { data, texto } = await pdfDe(
      invoiceB({
        invoiceType: 'A',
        cbteTipo: 1,
        invoiceNumber: 'A-0007-00000012',
        docTipo: 80,
        docNro: '30711111111',
        customer: { ...invoiceB().customer, taxCondition: 'RESPONSABLE_INSCRIPTO', cuit: '30-71111111-1', name: 'EMPRESA SA', businessName: 'EMPRESA SA' },
      })
    )
    expect(data.receptor.consumidorFinal).toBe(false)
    expect(texto).toContain('CUIT: 30-71111111-1')
    expect(texto).not.toContain(LEYENDA_CONSUMIDOR_FINAL)
    expect(texto).toContain('IVA Contenido')
    expect(texto).toContain('Otros Impuestos Nacionales Indirectos')
  })

  it('la descripción sale sin el código adelante ni el guión que lo separa', async () => {
    const { texto } = await pdfDe(invoiceB())
    expect(texto).toContain('(Válvula esférica 1")')
    expect(texto).not.toContain('- Válvula esférica')
  })
})

describe('PDF con adicionales (electroválvula + bobina + conector)', () => {
  /** Como A 0007-00000059 (VAL-2026-3599): un InvoiceItem con el precio combinado, 3 renglones en ARCA/Colppy */
  function invoiceConAdicionales(over: Record<string, unknown> = {}) {
    const a = invoiceB().customer
    return invoiceB({
      invoiceType: 'A',
      cbteTipo: 1,
      invoiceNumber: 'A-0007-00000059',
      docTipo: 80,
      docNro: '30711111111',
      currency: 'USD',
      exchangeRate: 1540,
      subtotal: 142.93,
      taxAmount: 30.02,
      total: 172.95,
      customer: { ...a, taxCondition: 'RESPONSABLE_INSCRIPTO', cuit: '30-71111111-1', name: 'EMPRESA SA', businessName: 'EMPRESA SA' },
      colppyPayload: {
        idCondicionPago: 'Contado',
        items: [
          { idItem: 0, Descripcion: '4020 06 Válvula Solenoide ODE', Cantidad: 1, ImporteUnitario: 124.85, porcDesc: 0 },
          { idItem: 11, Descripcion: '4808 C12 Bobina 12V 8 Watt', Cantidad: 1, ImporteUnitario: 14.89, porcDesc: 0 },
          { idItem: 12, Descripcion: '4801 08 Conector Tripolar', Cantidad: 1, ImporteUnitario: 3.19, porcDesc: 0 },
        ],
      },
      items: [
        {
          id: 'ii1',
          quoteItemId: 'qi1',
          sku: null,
          description: 'Válvula Solenoide ODE',
          comment: 'Pos. 10',
          quantity: 1,
          unitPrice: 142.93,
          discount: 0,
          subtotal: 142.93,
          taxRate: 21,
          product: { sku: '4020 06', name: '4020 06 Válvula Solenoide ODE' },
          quoteItem: {
            manualSku: null,
            description: 'Válvula Solenoide ODE',
            product: { sku: '4020 06', name: '4020 06 Válvula Solenoide ODE' },
            additionals: [
              { description: null, product: { sku: '4808 C12', name: '4808 C12 Bobina 12V 8 Watt' } },
              { description: null, product: { sku: '4801 08', name: '4801 08 Conector Tripolar' } },
            ],
          },
        },
      ],
      ...over,
    })
  }

  it('sale un renglón por artículo, como fue a ARCA/Colppy, y suman el neto', async () => {
    const { data } = await pdfDe(invoiceConAdicionales())
    expect(data.items.map((i) => [i.codigo, i.subtotal])).toEqual([
      ['4020 06', 124.85],
      ['4808 C12', 14.89],
      ['4801 08', 3.19],
    ])
    expect(data.items[0]).toMatchObject({ descripcion: 'Válvula Solenoide ODE', detalle: 'Pos. 10' })
    expect(data.items[1]).toMatchObject({ descripcion: '4808 C12 Bobina 12V 8 Watt', detalle: null })
    expect(data.items.reduce((s, i) => s + i.subtotal, 0)).toBeCloseTo(142.93, 2)
  })

  it('si el payload no se puede vincular, queda el renglón combinado', async () => {
    const inv = invoiceConAdicionales()
    const payload = inv.colppyPayload as { items: unknown[] }
    const { data } = await pdfDe({
      ...inv,
      colppyPayload: { ...payload, items: [...payload.items, { idItem: 0, Descripcion: 'Flete', Cantidad: 1, ImporteUnitario: 10 }] },
    })
    expect(data.items).toHaveLength(1)
    expect(data.items[0].subtotal).toBe(142.93)
  })
})

describe('helpers del PDF', () => {
  it('documento del receptor', () => {
    expect(documentoReceptorPdf({ docTipoLabel: 'CUIL', docNro: '20123456786' })).toBe('CUIL: 20-12345678-6')
    expect(documentoReceptorPdf({ docTipoLabel: 'CUIT', docNro: '30711111111' })).toBe('CUIT: 30-71111111-1')
    expect(documentoReceptorPdf({ docTipoLabel: 'CDI', docNro: '20123456786' })).toBe('CDI: 20-12345678-6')
    expect(documentoReceptorPdf({ docTipoLabel: 'DNI', docNro: '12345678' })).toBe('DNI: 12345678')
    expect(documentoReceptorPdf({ docTipoLabel: '', docNro: '' })).toBe('Doc: -')
  })

  it('descripción sin código: saca espacios, guiones y rayas después del código (y nada más)', () => {
    expect(descripcionSinCodigo('2025 04', '2025 04 Válvula esférica')).toBe('Válvula esférica')
    expect(descripcionSinCodigo('2025 04', '2025 04 - Válvula esférica')).toBe('Válvula esférica')
    expect(descripcionSinCodigo('V1', 'V1 – válvula')).toBe('válvula')
    expect(descripcionSinCodigo('V1', 'v1-Ñandú')).toBe('Ñandú')
    // La regex vieja (/^[s-–]+/ = rango de "s" a "–") se comía letras minúsculas y acentuadas
    expect(descripcionSinCodigo('AB', 'ABsoporte')).toBe('soporte')
    expect(descripcionSinCodigo('AB', 'ABúnico')).toBe('único')
    expect(descripcionSinCodigo('X9', 'Válvula X9')).toBe('Válvula X9')
    expect(descripcionSinCodigo(null, '  Válvula  ')).toBe('Válvula')
  })
})

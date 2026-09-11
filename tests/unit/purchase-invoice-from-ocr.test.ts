import { describe, it, expect } from 'vitest'
import { buildCreateInputFromOcr, parseVoucherTipo, totalsMatch } from '@/lib/purchase-invoices/from-ocr'
import { normalizeOcrData, type OcrData } from '@/lib/purchase-invoices/ocr-extract'
import { normalizePaymentTerm, paymentTermDays } from '@/lib/purchase-invoices/payment-terms'
import { generateSkuVariants, normalizeSkuForMatch } from '@/lib/purchase-invoices/sku-variants'
import { findTrustedSender, invoiceNumberFromFilename } from '@/lib/purchase-invoices/mail-ingest/senders'

function genebreOcr(overrides: Partial<OcrData> = {}): OcrData {
  return {
    proveedor: {
      razonSocial: 'GENEBRE DE ARGENTINA S.A.',
      cuit: '30-70812345-6',
      condicionIva: 'Responsable Inscripto',
      direccion: 'Buenos Aires',
    },
    factura: {
      tipo: 'FC A',
      puntoVenta: '00031',
      numero: '00304907',
      fecha: '2026-09-11',
      fechaVencimiento: null,
      cae: '76371234567890',
      vencimientoCae: '2026-09-21',
      condicionPago: 'CUENTA CORRIENTE 30 DIAS',
      moneda: 'ARS',
      tipoCambio: null,
      descuentoGeneral: 30,
      totalUsd: null,
    },
    items: [
      { codigo: '2416 04', descripcion: 'VALV ESFERICA 1/2', unidad: 'UNI', cantidad: 10, precioUnitario: 1000, descuento: 0, importe: 10000, alicuotaIva: 21 },
      { codigo: '2416 05', descripcion: 'VALV ESFERICA 3/4', unidad: 'UNI', cantidad: 5, precioUnitario: 2000, descuento: 0, importe: 10000, alicuotaIva: 21 },
    ],
    totales: {
      subtotalBruto: 20000,
      descuentoGeneral: 6000,
      subtotalNeto: 14000,
      iva21: 2940,
      iva105: 0,
      iva27: 0,
      percepciones: [
        { tipo: 'IIBB', descripcion: 'Perc. IIBB Buenos Aires', jurisdiccion: 'Buenos Aires', jurisdiccion_inferida: false, porcentaje: 3, monto: 420 },
      ],
      totalPercepciones: 420,
      // 14000 + 2940 + 420
      total: 17360,
    },
    ...overrides,
  }
}

describe('buildCreateInputFromOcr', () => {
  it('arma el input de una FC A de GENEBRE con descuento general y percepción IIBB', () => {
    const r = buildCreateInputFromOcr(genebreOcr(), { supplierId: 'sup1', supplierPaymentDays: 45 })

    expect(r.input.voucherType).toBe('A')
    expect(r.input.invoiceType).toBe('FA')
    expect(r.input.pointOfSale).toBe('00031')
    expect(r.input.invoiceNumberSuffix).toBe('00304907')
    expect(r.input.generalDiscount).toBe(30)
    expect(r.input.paymentTerms).toBe('a 30 Dias')
    // Sin fechaVencimiento: la condición de pago manda sobre los días del proveedor
    expect(r.input.dueDate).toBe('2026-10-11')
    expect(r.input.items).toHaveLength(2)
    expect(r.input.perceptions).toEqual([
      { jurisdiction: 'Buenos Aires', perceptionType: 'IIBB', rate: 3, baseAmount: 14000, amount: 420 },
    ])
    expect(r.computedTotal).toBe(17360)
    expect(r.totalMismatch).toBe(false)
    expect(r.reviewReason).toBeNull()
  })

  it('marca amount_mismatch cuando el total del OCR no cierra con los items', () => {
    const ocr = genebreOcr()
    ocr.totales.total = 20000
    const r = buildCreateInputFromOcr(ocr, { supplierId: 'sup1' })
    expect(r.totalMismatch).toBe(true)
    expect(r.reviewReason).toBe('amount_mismatch')
    expect(r.reviewNotes[0]).toContain('20000.00')
  })

  it('marca iibb_jurisdiction cuando la jurisdicción vino inferida o no se pudo resolver', () => {
    const ocr = genebreOcr()
    ocr.totales.percepciones = [
      { tipo: 'IIBB', descripcion: 'Reg. XYZ', jurisdiccion: null, jurisdiccion_inferida: null, jurisdiccion_hint: 'Reg. XYZ', porcentaje: null, monto: 420 },
    ]
    const r = buildCreateInputFromOcr(ocr, { supplierId: 'sup1' })
    expect(r.reviewReason).toBe('iibb_jurisdiction')
    expect(r.input.perceptions?.[0].jurisdiction).toBe('Reg. XYZ')
  })

  it('usa el vencimiento de la factura cuando viene y los días del proveedor si no hay condición', () => {
    const ocr = genebreOcr()
    ocr.factura.fechaVencimiento = '2026-10-30'
    expect(buildCreateInputFromOcr(ocr, { supplierId: 's' }).input.dueDate).toBe('2026-10-30')

    ocr.factura.fechaVencimiento = null
    ocr.factura.condicionPago = null
    expect(buildCreateInputFromOcr(ocr, { supplierId: 's', supplierPaymentDays: 60 }).input.dueDate).toBe('2026-11-10')
  })

  it('aplica la bonificación por item al precio de lista y descarta items sin cantidad', () => {
    const ocr = genebreOcr()
    ocr.factura.descuentoGeneral = 0
    ocr.totales.descuentoGeneral = 0
    ocr.items = [
      { codigo: 'X', descripcion: 'A', cantidad: 2, precioUnitario: 100, descuento: 10, alicuotaIva: 21 },
      { codigo: 'Y', descripcion: 'B', cantidad: 0, precioUnitario: 100, descuento: 0, alicuotaIva: 21 },
    ]
    ocr.totales.percepciones = []
    ocr.totales.total = 217.8
    const r = buildCreateInputFromOcr(ocr, { supplierId: 's' })
    expect(r.input.items).toHaveLength(1)
    expect(r.input.items[0].listPrice).toBeCloseTo(90)
    expect(r.totalMismatch).toBe(false)
  })

  it('falla con un mensaje claro si falta el número o la fecha', () => {
    const ocr = genebreOcr()
    ocr.factura.numero = ''
    expect(() => buildCreateInputFromOcr(ocr, { supplierId: 's' })).toThrow(/Número de comprobante/)

    const ocr2 = genebreOcr()
    ocr2.factura.fecha = '11/09/2026'
    expect(() => buildCreateInputFromOcr(ocr2, { supplierId: 's' })).toThrow(/Fecha/)
  })
})

describe('parseVoucherTipo', () => {
  it('reconoce FC/NC/ND con letra y la letra sola', () => {
    expect(parseVoucherTipo('FC A')).toEqual({ invoiceType: 'FA', voucherType: 'A' })
    expect(parseVoucherTipo('NC B')).toEqual({ invoiceType: 'NC', voucherType: 'B' })
    expect(parseVoucherTipo('nd c')).toEqual({ invoiceType: 'ND', voucherType: 'C' })
    expect(parseVoucherTipo('A')).toEqual({ invoiceType: 'FA', voucherType: 'A' })
    expect(() => parseVoucherTipo('FACTURA')).toThrow()
  })
})

describe('totalsMatch', () => {
  it('tolera $5 o 0,5% de diferencia', () => {
    expect(totalsMatch(100, 104)).toBe(true)
    expect(totalsMatch(100, 106)).toBe(false)
    expect(totalsMatch(1_000_000, 1_004_000)).toBe(true)
    expect(totalsMatch(1_000_000, 1_006_000)).toBe(false)
  })
})

describe('normalizeOcrData', () => {
  it('rellena PV/número, saca el prefijo 001 de GENEBRE y el descuento duplicado en items', () => {
    const ocr = genebreOcr()
    ocr.factura.puntoVenta = '31'
    ocr.factura.numero = '304907'
    ocr.items[0].codigo = '0012416 04'
    ocr.items[0].descuento = 30
    normalizeOcrData(ocr)
    expect(ocr.factura.puntoVenta).toBe('00031')
    expect(ocr.factura.numero).toBe('00304907')
    expect(ocr.items[0].codigo).toBe('2416 04')
    expect(ocr.items[0].descuento).toBe(0)
  })
})

describe('payment-terms', () => {
  it('normaliza al formato Colppy y devuelve los días', () => {
    expect(normalizePaymentTerm('CUENTA CORRIENTE 30 DIAS')).toBe('a 30 Dias')
    expect(normalizePaymentTerm('Contado')).toBe('Contado')
    expect(normalizePaymentTerm('cta cte')).toBe('a 30 Dias')
    expect(paymentTermDays('a 45 Dias')).toBe(45)
    expect(paymentTermDays('Contado')).toBe(0)
    expect(paymentTermDays('')).toBeNull()
  })
})

describe('generateSkuVariants', () => {
  it('quita ceros iniciales progresivamente', () => {
    expect(generateSkuVariants('0012416 04')).toEqual(['12416 04', '012416 04', '0012416 04'])
    expect(generateSkuVariants('2416 04')).toEqual(['2416 04'])
    expect(generateSkuVariants('  ')).toEqual([])
  })
})

describe('normalizeSkuForMatch', () => {
  it('iguala los códigos de la factura GENEBRE con los SKUs del catálogo', () => {
    expect(normalizeSkuForMatch('5800-140')).toBe(normalizeSkuForMatch('5800 140'))
    expect(normalizeSkuForMatch('451902 C24')).toBe(normalizeSkuForMatch('4519 02 C24'))
    expect(normalizeSkuForMatch('2025 07')).not.toBe(normalizeSkuForMatch('2025 07 MD'))
  })
})

describe('senders', () => {
  it('reconoce a GENEBRE sin importar mayúsculas y rechaza al resto', () => {
    expect(findTrustedSender('FacturaElectronica@genebre.com.ar')?.label).toBe('GENEBRE')
    expect(findTrustedSender('ventas@otro.com')).toBeNull()
    expect(findTrustedSender(undefined)).toBeNull()
  })

  it('saca el número de comprobante del nombre del PDF de GENEBRE', () => {
    expect(invoiceNumberFromFilename('FACA0003100304907.pdf')).toBe('A00031-00304907')
    expect(invoiceNumberFromFilename('FACA0003100304907AFIP.XML')).toBe('A00031-00304907')
    expect(invoiceNumberFromFilename('factura.pdf')).toBeNull()
  })
})

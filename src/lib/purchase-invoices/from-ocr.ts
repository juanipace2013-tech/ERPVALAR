/**
 * Convierte el JSON del OCR (ocr-extract.ts) en el input de createPurchaseInvoice.
 *
 * Replica lo que hace la pantalla de carga manual (applyOcrData + handleSubmit
 * en proveedores/facturas-compra/nueva) pero sin operador en el medio, así que
 * además compara el total que leyó el OCR contra el que calcula el ERP y
 * devuelve las señales de revisión para que el caller marque la factura.
 * Funciones puras: sin DB.
 */

import { resolveJurisdiccionIIBB } from '@/lib/jurisdicciones-iibb'
import { REVIEW_REASONS, type ReviewReason } from '@/lib/review-reasons'
import { normalizePaymentTerm, paymentTermDays } from './payment-terms'
import type { OcrData } from './ocr-extract'
import type { CreatePurchaseInvoiceInput, CreatePurchaseInvoicePerceptionInput } from './create'

export interface BuildFromOcrOptions {
  supplierId: string
  /** Días de plazo del proveedor, para el vencimiento si la factura no lo trae. */
  supplierPaymentDays?: number | null
}

export interface BuildFromOcrResult {
  input: CreatePurchaseInvoiceInput
  currency: string
  /** Total que figura en la factura según el OCR. */
  ocrTotal: number
  /** Total que va a calcular el ERP con items + IVA + percepciones. */
  computedTotal: number
  totalMismatch: boolean
  /** amount_mismatch > iibb_jurisdiction > null. El caller puede anteponer otros motivos. */
  reviewReason: ReviewReason | null
  /** Explicaciones para dejar en internalNotes. */
  reviewNotes: string[]
}

export class OcrMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OcrMappingError'
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isDate(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(value))
}

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** "FC A" → { invoiceType: 'FA', voucherType: 'A' }; también "NC A", "ND B" y la letra sola. */
export function parseVoucherTipo(tipo: string | undefined | null, tipoComprobante?: string): {
  invoiceType: string
  voucherType: 'A' | 'B' | 'C'
} {
  const tipoStr = (tipo || '').toUpperCase().trim()
  const match = tipoStr.match(/^(FC|ND|NC|FA)\s*([ABC])$/)
  if (match) {
    return { invoiceType: match[1] === 'FC' ? 'FA' : match[1], voucherType: match[2] as 'A' | 'B' | 'C' }
  }
  if (['A', 'B', 'C'].includes(tipoStr)) {
    return { invoiceType: tipoComprobante || 'FA', voucherType: tipoStr as 'A' | 'B' | 'C' }
  }
  throw new OcrMappingError(`Tipo de comprobante no reconocido: "${tipo || ''}"`)
}

/** Tolerancia para comparar el total del OCR con el calculado: $5 o 0,5%, lo que sea mayor. */
export function totalsMatch(ocrTotal: number, computedTotal: number): boolean {
  const tolerance = Math.max(5, Math.abs(ocrTotal) * 0.005)
  return Math.abs(ocrTotal - computedTotal) <= tolerance
}

export function buildCreateInputFromOcr(data: OcrData, opts: BuildFromOcrOptions): BuildFromOcrResult {
  const f = data.factura
  if (!f) throw new OcrMappingError('El OCR no devolvió datos del comprobante')

  const { invoiceType, voucherType } = parseVoucherTipo(f.tipo, f.tipoComprobante)

  const pointOfSale = String(f.puntoVenta || '').replace(/\D/g, '')
  const numero = String(f.numero || '').replace(/\D/g, '')
  if (!pointOfSale || !numero) {
    throw new OcrMappingError(`Número de comprobante incompleto (PV "${f.puntoVenta}", N° "${f.numero}")`)
  }

  if (!isDate(f.fecha)) throw new OcrMappingError(`Fecha de comprobante inválida: "${f.fecha}"`)
  const invoiceDate = f.fecha

  const paymentTerms = normalizePaymentTerm(f.condicionPago || '')
  let dueDate: string
  if (isDate(f.fechaVencimiento)) {
    dueDate = f.fechaVencimiento
  } else {
    const days = paymentTermDays(paymentTerms) ?? opts.supplierPaymentDays ?? 30
    dueDate = addDays(invoiceDate, days)
  }

  // Descuento general: del encabezado, o inferido de los totales como hace la UI
  let generalDiscount = Number(f.descuentoGeneral) || 0
  const t = data.totales
  if (generalDiscount <= 0 && t) {
    if (t.descuentoGeneral && t.subtotalBruto) {
      generalDiscount = Math.round((t.descuentoGeneral / t.subtotalBruto) * 100 * 100) / 100
    } else if (t.descuento && t.subtotal) {
      generalDiscount = Math.round((t.descuento / t.subtotal) * 100 * 100) / 100
    }
  }

  const items = (data.items || [])
    .map((item) => {
      const bonificacion = Number(item.descuento) || Number(item.bonificacion) || 0
      const precio = Number(item.precioUnitario) || 0
      return {
        productId: null,
        supplierProductCode: (item.codigo || '').trim(),
        description: item.descripcion || '',
        unit: item.unidad || 'UN',
        quantity: Number(item.cantidad) || 0,
        listPrice: precio * (1 - bonificacion / 100),
        taxRate: Number(item.alicuotaIva) || 21,
      }
    })
    .filter((item) => item.quantity > 0)

  if (items.length === 0) throw new OcrMappingError('El OCR no encontró items con cantidad')

  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.listPrice, 0)
  const netAmount = subtotal * (1 - generalDiscount / 100)
  const taxAmount = items.reduce((sum, i) => sum + i.quantity * i.listPrice * (1 - generalDiscount / 100) * (i.taxRate / 100), 0)

  const reviewNotes: string[] = []
  let reviewReason: ReviewReason | null = null
  const perceptions: CreatePurchaseInvoicePerceptionInput[] = []

  if (t?.percepciones && Array.isArray(t.percepciones) && t.percepciones.length > 0) {
    t.percepciones.forEach((p, idx) => {
      const monto = Number(p.monto) || 0
      if (monto <= 0) return

      const juris = p.jurisdiccion || null
      const inferida = p.jurisdiccion_inferida === true
      const textoOriginal = p.texto_original || p.descripcion || null
      const rawDesc = (juris && !inferida ? juris : p.descripcion || textoOriginal || `Percepción ${idx + 1}`).trim()
      const descUpper = rawDesc.toUpperCase()

      const isIVA = /\bIVA\b/i.test(descUpper) && !/IIBB|\bIB\b/i.test(descUpper)
      const isGanancias = /GANANCIAS/i.test(descUpper) && !/IIBB|\bIB\b/i.test(descUpper)
      const isSUSS = /SUSS/i.test(descUpper)

      let perceptionType: string
      let jurisdiction: string
      if (isIVA) {
        perceptionType = 'IVA'
        jurisdiction = 'NACIONAL'
      } else if (isGanancias) {
        perceptionType = 'Ganancias'
        jurisdiction = 'NACIONAL'
      } else if (isSUSS) {
        perceptionType = 'SUSS'
        jurisdiction = 'NACIONAL'
      } else {
        perceptionType = 'IIBB'
        const resolved = resolveJurisdiccionIIBB(rawDesc)
        if (!resolved || inferida) {
          reviewReason = REVIEW_REASONS.IIBB_JURISDICTION
          reviewNotes.push(
            `Percepción IIBB "${textoOriginal || rawDesc}": ` +
              (resolved ? `jurisdicción ${resolved} inferida por el OCR` : 'jurisdicción no determinada') +
              (p.jurisdiccion_hint ? ` (pista: ${p.jurisdiccion_hint})` : '')
          )
        }
        jurisdiction = resolved || rawDesc || '(sin jurisdicción)'
      }

      perceptions.push({
        jurisdiction,
        perceptionType,
        rate: Number(p.porcentaje) || 0,
        baseAmount: netAmount,
        amount: monto,
      })
    })
  } else if (t) {
    // Formato viejo del OCR: montos sueltos sin detalle. Sin jurisdicción no
    // hay forma de mandarlo a Colppy, así que queda para revisión.
    const iibb = Number(t.percepcionIIBB) || 0
    const iva = Number(t.percepcionIva) || 0
    const otros = (Number(t.impuestosInternos) || 0) + (Number(t.otrosImpuestos) || 0)
    if (iibb > 0) {
      perceptions.push({ jurisdiction: '(sin jurisdicción)', perceptionType: 'IIBB', rate: 0, baseAmount: netAmount, amount: iibb })
      reviewReason = REVIEW_REASONS.IIBB_JURISDICTION
      reviewNotes.push('Percepción IIBB sin detalle de jurisdicción')
    }
    if (iva > 0) perceptions.push({ jurisdiction: 'NACIONAL', perceptionType: 'IVA', rate: 0, baseAmount: netAmount, amount: iva })
    if (otros > 0) perceptions.push({ jurisdiction: 'NACIONAL', perceptionType: 'OTROS', rate: 0, baseAmount: netAmount, amount: otros })
  }

  const perceptionsAmount = perceptions.reduce((sum, p) => sum + p.amount, 0)
  const computedTotal = Math.round((netAmount + taxAmount + perceptionsAmount) * 100) / 100
  const ocrTotal = Number(t?.total) || 0
  const totalMismatch = ocrTotal <= 0 || !totalsMatch(ocrTotal, computedTotal)
  if (totalMismatch) {
    reviewReason = REVIEW_REASONS.AMOUNT_MISMATCH
    reviewNotes.unshift(
      `Total según la factura: ${ocrTotal.toFixed(2)} — total calculado por el ERP: ${computedTotal.toFixed(2)}`
    )
  }

  const input: CreatePurchaseInvoiceInput = {
    supplierId: opts.supplierId,
    voucherType,
    invoiceType,
    invoiceDate,
    dueDate,
    pointOfSale: pointOfSale.padStart(5, '0'),
    invoiceNumberSuffix: numero.padStart(8, '0'),
    cae: f.cae || null,
    caeExpirationDate: isDate(f.vencimientoCae) ? f.vencimientoCae : null,
    paymentTerms,
    generalDiscount,
    items,
    perceptions: perceptions.length > 0 ? perceptions : undefined,
  }

  return {
    input,
    currency: (f.moneda || 'ARS').toUpperCase(),
    ocrTotal,
    computedTotal,
    totalMismatch,
    reviewReason,
    reviewNotes,
  }
}

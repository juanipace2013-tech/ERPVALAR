/**
 * Alta de una factura de compra con sus items, IVA y percepciones.
 *
 * Es la lógica de POST /api/purchase-invoices, separada del handler para que
 * también la pueda usar el cron que carga facturas desde el mail de
 * facturación (que no tiene sesión de usuario).
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { resolveJurisdiccionIIBB, COLPPY_JURISDICCIONES } from '@/lib/jurisdicciones-iibb'
import { REVIEW_REASONS, isReviewReason, type ReviewReason } from '@/lib/review-reasons'

export interface CreatePurchaseInvoiceItemInput {
  productId?: string | null
  supplierProductCode?: string | null
  description: string
  unit?: string
  quantity: number
  listPrice: number
  taxRate: number
  accountId?: string | null
  batchNumber?: string | null
  expirationDate?: string | null
  importInfo?: string | null
}

export interface CreatePurchaseInvoicePerceptionInput {
  jurisdiction: string
  perceptionType: string
  regulation?: string | null
  rate: number
  baseAmount: number
  amount: number
  accountId?: string | null
}

export interface CreatePurchaseInvoiceInput {
  supplierId: string
  voucherType: 'A' | 'B' | 'C'
  invoiceType?: string
  invoiceDate: string // YYYY-MM-DD
  dueDate: string // YYYY-MM-DD
  pointOfSale: string
  invoiceNumberSuffix: string
  cae?: string | null
  caeExpirationDate?: string | null
  paymentTerms?: string | null
  generalDiscount?: number
  description?: string | null
  internalNotes?: string | null
  sourceFileUrl?: string | null
  items: CreatePurchaseInvoiceItemInput[]
  taxes?: Array<{ taxType: string; rate: number; baseAmount: number; taxAmount: number }>
  perceptions?: CreatePurchaseInvoicePerceptionInput[]
  // Flags de revisión que trae el caller (ej. flujo OCR con jurisdicción
  // inferida). El server siempre re-evalúa las percepciones y puede marcar
  // requiresReview por su cuenta aunque el caller no lo haya hecho.
  requiresReview?: boolean
  reviewReason?: string | null
}

const invoiceInclude = {
  supplier: true,
  items: { include: { product: true } },
  taxes: true,
  perceptions: true,
} satisfies Prisma.PurchaseInvoiceInclude

export type CreatedPurchaseInvoice = Prisma.PurchaseInvoiceGetPayload<{ include: typeof invoiceInclude }>

export interface CreatePurchaseInvoiceResult {
  invoice: CreatedPurchaseInvoice
  warnings: string[]
  requiresReview: boolean
  reviewReason: ReviewReason | null
  autoLinkedCount: number
}

/** Número de comprobante tal como se guarda en invoiceNumber (@unique). */
export function buildInvoiceNumber(voucherType: string, pointOfSale: string, suffix: string): string {
  return `${voucherType}${pointOfSale}-${suffix}`
}

/** true si el error es el unique de invoiceNumber (comprobante ya cargado). */
export function isDuplicateInvoiceError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false
  const target = error.meta?.target
  const targetFields = Array.isArray(target) ? target : typeof target === 'string' ? [target] : []
  return targetFields.length === 0 || targetFields.some((f) => String(f).includes('invoiceNumber'))
}

export async function createPurchaseInvoice(
  input: CreatePurchaseInvoiceInput,
  createdBy: string
): Promise<CreatePurchaseInvoiceResult> {
  const {
    supplierId,
    voucherType,
    invoiceType,
    invoiceDate,
    dueDate,
    pointOfSale,
    invoiceNumberSuffix,
    cae,
    caeExpirationDate,
    paymentTerms,
    description,
    internalNotes,
    sourceFileUrl,
    items,
    taxes,
    perceptions,
  } = input
  const generalDiscount = Number(input.generalDiscount) || 0

  const warnings: string[] = []
  let effectiveRequiresReview = Boolean(input.requiresReview)
  let effectiveReviewReason: ReviewReason | null =
    isReviewReason(input.reviewReason) ? input.reviewReason : null

  // Totales
  let subtotal = 0
  let taxAmount = 0
  let perceptionsAmount = 0

  items.forEach((item) => {
    subtotal += Number(item.listPrice) * Number(item.quantity)
  })

  const discountAmount = subtotal * (generalDiscount / 100)
  const netAmount = subtotal - discountAmount

  items.forEach((item) => {
    const itemNetAmount = Number(item.listPrice) * Number(item.quantity) * (1 - generalDiscount / 100)
    taxAmount += itemNetAmount * (Number(item.taxRate) / 100)
  })

  // Normalizar jurisdicciones IIBB a una canónica de Colppy (24 provincias).
  // NUNCA default a "NACIONAL". Otros tipos (IVA, Ganancias, SUSS) quedan en 'NACIONAL'.
  // Si una percepción IIBB no resuelve, en vez de fallar guardamos la factura con
  // requiresReview=true y reviewReason='iibb_jurisdiction'; send-to-colppy bloquea
  // hasta que el operador corrija la jurisdicción y limpie el flag.
  if (perceptions && Array.isArray(perceptions)) {
    for (const perception of perceptions) {
      if (perception.perceptionType === 'IIBB') {
        const rawLabel = perception.jurisdiction || ''
        const resolved = resolveJurisdiccionIIBB(rawLabel)
        if (resolved) {
          perception.jurisdiction = resolved
        } else {
          perception.jurisdiction = String(rawLabel).slice(0, 100) || '(sin jurisdicción)'
          effectiveRequiresReview = true
          effectiveReviewReason = REVIEW_REASONS.IIBB_JURISDICTION
          warnings.push(
            `Percepción IIBB con jurisdicción no reconocida: "${rawLabel || '(vacío)'}". ` +
              `La factura se guardó con flag de revisión — no podrá enviarse a Colppy hasta que ` +
              `un operador seleccione una jurisdicción válida (${COLPPY_JURISDICCIONES.join(', ')}).`
          )
        }
      }
      perceptionsAmount += Number(perception.amount)
    }
  }

  const total = netAmount + taxAmount + perceptionsAmount
  const invoiceNumber = buildInvoiceNumber(voucherType, pointOfSale, invoiceNumberSuffix)

  const purchaseInvoice = await prisma.purchaseInvoice.create({
    data: {
      invoiceNumber,
      supplierId,
      voucherType,
      invoiceType: invoiceType || 'FA',
      invoiceDate: new Date(invoiceDate + 'T12:00:00Z'),
      receiptDate: new Date(),
      dueDate: new Date(dueDate + 'T12:00:00Z'),
      pointOfSale,
      invoiceNumberSuffix,
      cae: cae || null,
      caeExpirationDate: caeExpirationDate ? new Date(caeExpirationDate + 'T12:00:00Z') : null,
      paymentTerms: paymentTerms || null,
      generalDiscount,
      subtotal,
      discountAmount,
      netAmount,
      taxAmount,
      perceptionsAmount,
      total,
      balance: total,
      status: 'PENDING',
      description: description || null,
      internalNotes: internalNotes || null,
      sourceFileUrl: sourceFileUrl || null,
      requiresReview: effectiveRequiresReview,
      reviewReason: effectiveReviewReason,
      createdBy,
      items: {
        create: items.map((item) => {
          const itemSubtotal = Number(item.listPrice) * Number(item.quantity)
          const itemNetAmount = itemSubtotal * (1 - generalDiscount / 100)
          const itemTaxAmount = itemNetAmount * (Number(item.taxRate) / 100)

          return {
            productId: item.productId || null,
            supplierProductCode: item.supplierProductCode || null,
            description: item.description,
            unit: item.unit || 'UN',
            quantity: item.quantity,
            listPrice: item.listPrice,
            discountPercent: generalDiscount,
            unitPrice: Number(item.listPrice) * (1 - generalDiscount / 100),
            subtotal: itemNetAmount,
            taxRate: item.taxRate,
            taxAmount: itemTaxAmount,
            total: itemNetAmount + itemTaxAmount,
            accountId: item.accountId || null,
            batchNumber: item.batchNumber || null,
            expirationDate: item.expirationDate ? new Date(item.expirationDate + 'T12:00:00Z') : null,
            importInfo: item.importInfo || null,
          }
        }),
      },
      taxes: taxes
        ? {
            create: taxes.map((tax) => ({
              taxType: tax.taxType,
              rate: tax.rate,
              baseAmount: tax.baseAmount,
              taxAmount: tax.taxAmount,
            })),
          }
        : undefined,
      perceptions: perceptions
        ? {
            create: perceptions.map((perception) => ({
              jurisdiction: perception.jurisdiction,
              perceptionType: perception.perceptionType,
              regulation: perception.regulation || null,
              rate: perception.rate,
              baseAmount: perception.baseAmount,
              amount: perception.amount,
              accountId: perception.accountId || null,
            })),
          }
        : undefined,
    },
    include: invoiceInclude,
  })

  // Auto-vincular items por código de proveedor → SKU del catálogo (batch)
  let autoLinkedCount = 0
  const unlinkItems = purchaseInvoice.items.filter((i) => !i.productId && i.supplierProductCode)
  if (unlinkItems.length > 0) {
    const allCodes: string[] = []
    for (const item of unlinkItems) {
      const code = item.supplierProductCode!.trim()
      allCodes.push(code)
      if (code.startsWith('001') && code.length > 3) {
        allCodes.push(code.substring(3).trim())
      }
    }
    const matchedProducts = await prisma.product.findMany({
      where: { sku: { in: [...new Set(allCodes)] }, status: 'ACTIVE' },
      select: { id: true, sku: true },
    })
    const skuMap = new Map(matchedProducts.map((p) => [p.sku, p.id]))

    const updates: Promise<unknown>[] = []
    for (const item of unlinkItems) {
      const code = item.supplierProductCode!.trim()
      const altCode = code.startsWith('001') && code.length > 3 ? code.substring(3).trim() : null
      const productId = skuMap.get(code) || (altCode ? skuMap.get(altCode) : null)
      if (productId) {
        updates.push(prisma.purchaseInvoiceItem.update({ where: { id: item.id }, data: { productId } }))
        autoLinkedCount++
      }
    }
    if (updates.length > 0) await Promise.all(updates)
  }

  if (autoLinkedCount > 0) {
    logger.info(`[FC Auto-link] ${autoLinkedCount}/${purchaseInvoice.items.length} items auto-vinculados`)
  }

  const invoice =
    autoLinkedCount > 0
      ? (await prisma.purchaseInvoice.findUnique({ where: { id: purchaseInvoice.id }, include: invoiceInclude }))!
      : purchaseInvoice

  return {
    invoice,
    warnings,
    requiresReview: effectiveRequiresReview,
    reviewReason: effectiveReviewReason,
    autoLinkedCount,
  }
}

/**
 * Purchase Invoice Stock Processing Service
 * Handles stock impact and reversal from purchase invoices
 */

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

interface ProcessResult {
  processedItems: number
  skippedItems: number
  totalQuantity: number
  totalValue: number
  details: Array<{
    productId: string
    productName: string
    quantity: number
    unitPrice: number
  }>
  skippedDetails: Array<{
    description: string
    quantity: number
    reason: string
  }>
}

/**
 * Get or create the default warehouse
 */
async function getDefaultWarehouse(tx: Prisma.TransactionClient) {
  let warehouse = await tx.warehouse.findFirst({
    where: { isDefault: true },
  })

  if (!warehouse) {
    warehouse = await tx.warehouse.create({
      data: {
        code: 'DEP-01',
        name: 'Depósito Principal',
        isDefault: true,
        isActive: true,
      },
    })
  }

  return warehouse
}

/**
 * +1 si el comprobante de compra entra mercadería (factura, ND), -1 si la saca
 * (nota de crédito: devolución al proveedor).
 */
export function purchaseStockSign(invoiceType: string | null | undefined): 1 | -1 {
  return invoiceType === 'NC' ? -1 : 1
}

/**
 * Process a purchase invoice to impact stock
 */
export async function processPurchaseInvoiceStock(
  invoiceId: string,
  userId: string
): Promise<ProcessResult> {
  return await prisma.$transaction(async (tx) => {
    const invoice = await tx.purchaseInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        supplier: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    })

    if (!invoice) {
      throw new Error('Factura no encontrada')
    }

    if (invoice.stockImpact) {
      throw new Error('Esta factura ya impactó en el inventario')
    }

    const sign = purchaseStockSign(invoice.invoiceType)
    const isCreditNote = sign < 0
    const warehouse = await getDefaultWarehouse(tx)

    let processedItems = 0
    let skippedItems = 0
    let totalQuantity = 0
    let totalValue = 0
    const details: ProcessResult['details'] = []
    const skippedDetails: ProcessResult['skippedDetails'] = []

    for (const item of invoice.items) {
      // Skip items without product link
      if (!item.productId || !item.product) {
        skippedItems++
        skippedDetails.push({
          description: item.description,
          quantity: Number(item.quantity),
          reason: item.colppyAccount ? `Gasto (${item.colppyAccount.trim()})` : 'Sin producto vinculado',
        })
        continue
      }

      // Skip already processed items
      if (item.stockProcessed) {
        skippedItems++
        skippedDetails.push({
          description: item.description,
          quantity: Number(item.quantity),
          reason: 'Ya procesado',
        })
        continue
      }

      const qty = Math.round(Number(item.quantity))
      const unitPrice = Number(item.unitPrice)
      const product = item.product

      if (qty <= 0) continue

      // NC: la mercadería vuelve al proveedor → sale del stock
      const delta = qty * sign
      const stockBefore = product.stockQuantity
      const stockAfter = stockBefore + delta

      // Create stock movement
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          warehouseId: warehouse.id,
          purchaseInvoiceId: invoiceId,
          userId,
          type: isCreditNote ? 'DEVOLUCION_PROVEEDOR' : 'COMPRA',
          quantity: delta,
          unitCost: unitPrice,
          totalCost: unitPrice * qty,
          currency: invoice.currency as 'ARS' | 'USD',
          stockBefore,
          stockAfter,
          reference: invoice.invoiceNumber,
          notes: `${isCreditNote ? 'NC compra' : 'Compra'} ${invoice.invoiceNumber} - ${invoice.supplier.name}`,
          date: invoice.invoiceDate,
        },
      })

      if (isCreditNote) {
        // Una devolución no cambia el costo de lo que queda en stock
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQuantity: stockAfter },
        })
      } else {
        // Calculate weighted average cost
        const oldAvg = Number(product.averageCost || 0)
        const oldQty = product.stockQuantity
        let newAvgCost: number
        if (oldQty + qty > 0) {
          newAvgCost = ((oldAvg * oldQty) + (unitPrice * qty)) / (oldQty + qty)
        } else {
          newAvgCost = oldAvg
        }

        await tx.product.update({
          where: { id: item.productId },
          data: {
            stockQuantity: stockAfter,
            lastCost: unitPrice,
            averageCost: Math.round(newAvgCost * 100) / 100,
          },
        })
      }

      // Update or create warehouse stock
      await tx.warehouseStock.upsert({
        where: {
          warehouseId_productId: {
            warehouseId: warehouse.id,
            productId: item.productId,
          },
        },
        update: {
          quantity: { increment: delta },
          lastUpdated: new Date(),
        },
        create: {
          warehouseId: warehouse.id,
          productId: item.productId,
          quantity: delta,
          lastUpdated: new Date(),
        },
      })

      // Mark item as processed
      await tx.purchaseInvoiceItem.update({
        where: { id: item.id },
        data: { stockProcessed: true },
      })

      processedItems++
      totalQuantity += qty
      totalValue += unitPrice * qty
      details.push({
        productId: item.productId,
        productName: product.name,
        quantity: qty,
        unitPrice,
      })
    }

    // Mark invoice as stock impacted
    await tx.purchaseInvoice.update({
      where: { id: invoiceId },
      data: {
        stockImpact: true,
        stockImpactedAt: new Date(),
      },
    })

    return {
      processedItems,
      skippedItems,
      totalQuantity,
      totalValue,
      details,
      skippedDetails,
    }
  }, {
    maxWait: 10000,
    timeout: 30000,
  })
}

/**
 * Reverse the stock impact of a purchase invoice
 */
export async function reversePurchaseInvoiceStock(
  invoiceId: string,
  userId: string
): Promise<{ reversedItems: number; totalQuantity: number; totalValue: number }> {
  return await prisma.$transaction(async (tx) => {
    const invoice = await tx.purchaseInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        supplier: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    })

    if (!invoice) {
      throw new Error('Factura no encontrada')
    }

    if (!invoice.stockImpact) {
      throw new Error('Esta factura no tiene impacto en inventario para reversar')
    }

    // El signo sale de lo que efectivamente se movió, no del tipo actual: una NC
    // impactada antes del fix (o cargada como FA y corregida) entró como COMPRA.
    const sawReturn = await tx.stockMovement.findFirst({
      where: { purchaseInvoiceId: invoiceId, type: 'DEVOLUCION_PROVEEDOR' },
      select: { id: true },
    })
    const wasCreditNote = Boolean(sawReturn)
    const warehouse = await getDefaultWarehouse(tx)

    let reversedItems = 0
    let totalQuantity = 0
    let totalValue = 0

    for (const item of invoice.items) {
      if (!item.productId || !item.product || !item.stockProcessed) {
        continue
      }

      const qty = Math.round(Number(item.quantity))
      const unitPrice = Number(item.unitPrice)
      const product = item.product

      if (qty <= 0) continue

      // Reversa de una NC: la mercadería vuelve a entrar
      const delta = wasCreditNote ? qty : -qty
      const stockBefore = product.stockQuantity
      const stockAfter = stockBefore + delta

      // Create reversal movement
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          warehouseId: warehouse.id,
          purchaseInvoiceId: invoiceId,
          userId,
          type: wasCreditNote ? 'AJUSTE_POSITIVO' : 'AJUSTE_NEGATIVO',
          quantity: delta,
          unitCost: unitPrice,
          totalCost: unitPrice * qty,
          currency: invoice.currency as 'ARS' | 'USD',
          stockBefore,
          stockAfter,
          reference: `REV-${invoice.invoiceNumber}`,
          notes: `Reversa ${wasCreditNote ? 'NC compra' : 'compra'} ${invoice.invoiceNumber} - ${invoice.supplier.name}`,
          date: new Date(),
        },
      })

      // Revert product stock
      await tx.product.update({
        where: { id: item.productId },
        data: {
          stockQuantity: { increment: delta },
        },
      })

      // Revert warehouse stock
      await tx.warehouseStock.updateMany({
        where: {
          warehouseId: warehouse.id,
          productId: item.productId,
        },
        data: {
          quantity: { increment: delta },
          lastUpdated: new Date(),
        },
      })

      // Unmark item
      await tx.purchaseInvoiceItem.update({
        where: { id: item.id },
        data: { stockProcessed: false },
      })

      reversedItems++
      totalQuantity += qty
      totalValue += unitPrice * qty
    }

    // Unmark invoice
    await tx.purchaseInvoice.update({
      where: { id: invoiceId },
      data: {
        stockImpact: false,
        stockImpactedAt: null,
      },
    })

    return { reversedItems, totalQuantity, totalValue }
  }, {
    maxWait: 10000,
    timeout: 30000,
  })
}

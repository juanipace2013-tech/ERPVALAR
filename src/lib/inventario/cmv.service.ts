/**
 * CMV (Costo de Mercadería Vendida) Service
 * Handles cost calculation and accounting entries for sales
 */

import { prisma } from '@/lib/prisma';
import { Currency, StockMovementType, Prisma } from '@prisma/client';
import type { CMVCalculation } from './types';

/**
 * Get unit cost for a product (average weighted cost method)
 */
export async function getUnitCost(
  productId: string,
  tx?: Prisma.TransactionClient
): Promise<number> {
  const client = tx || prisma;

  // Strategy 1: Get last purchase or positive adjustment cost
  const lastPurchase = await client.stockMovement.findFirst({
    where: {
      productId,
      type: { in: [StockMovementType.COMPRA, StockMovementType.AJUSTE_POSITIVO] },
    },
    orderBy: { date: 'desc' },
    select: { unitCost: true },
  });

  if (lastPurchase) {
    return Number(lastPurchase.unitCost);
  }

  // Strategy 2: Fallback to product cost price
  const costPrice = await client.productPrice.findFirst({
    where: {
      productId,
      priceType: 'COST',
      OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
    },
    orderBy: { validFrom: 'desc' },
    select: { amount: true },
  });

  if (costPrice) {
    return Number(costPrice.amount);
  }

  throw new Error(
    `Producto ${productId} no tiene costo definido. ` +
      `Debe registrar una compra o definir un precio de costo.`
  );
}

/**
 * Calculate CMV for a list of items
 */
export async function calculateCMV(
  items: Array<{ productId: string; quantity: number }>,
  tx?: Prisma.TransactionClient
): Promise<CMVCalculation> {
  const client = tx || prisma;
  const itemsCost: CMVCalculation['itemsCost'] = [];
  let totalCMV = 0;

  for (const item of items) {
    const unitCost = await getUnitCost(item.productId, client);
    const totalCost = item.quantity * unitCost;

    itemsCost.push({
      productId: item.productId,
      quantity: item.quantity,
      unitCost,
      totalCost,
    });

    totalCMV += totalCost;
  }

  return {
    totalCMV,
    currency: Currency.ARS, // Default to ARS, can be parameterized if needed
    itemsCost,
  };
}

/**
 * Validate that all products have cost defined before processing sale
 */
export async function validateProductsCost(
  productIds: string[],
  tx?: Prisma.TransactionClient
): Promise<{ valid: boolean; missingCost: string[] }> {
  const client = tx || prisma;
  const missingCost: string[] = [];

  for (const productId of productIds) {
    try {
      await getUnitCost(productId, client);
    } catch (_error) {
      missingCost.push(productId);
    }
  }

  return {
    valid: missingCost.length === 0,
    missingCost,
  };
}

/**
 * Get product names for error messages
 */
export async function getProductNames(productIds: string[]): Promise<Map<string, string>> {
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true },
  });

  return new Map(products.map((p) => [p.id, p.name]));
}

/**
 * Calculate weighted average cost from all stock movements
 * (Alternative method for future use)
 */
export async function calculateWeightedAverageCost(
  productId: string,
  tx?: Prisma.TransactionClient
): Promise<number | null> {
  const client = tx || prisma;

  // Get all purchase movements
  const purchases = await client.stockMovement.findMany({
    where: {
      productId,
      type: { in: [StockMovementType.COMPRA, StockMovementType.AJUSTE_POSITIVO] },
    },
    select: {
      quantity: true,
      unitCost: true,
    },
  });

  if (purchases.length === 0) {
    return null;
  }

  // Calculate weighted average
  let totalQuantity = 0;
  let totalCost = 0;

  for (const purchase of purchases) {
    const qty = Math.abs(purchase.quantity);
    const cost = Number(purchase.unitCost);
    totalQuantity += qty;
    totalCost += qty * cost;
  }

  if (totalQuantity === 0) {
    return null;
  }

  return totalCost / totalQuantity;
}

/**
 * Get CMV for a specific period (for reports)
 */
export async function getCMVForPeriod(
  startDate: Date,
  endDate: Date
): Promise<{
  totalCMV: number;
  movements: Array<{
    date: Date;
    productId: string;
    productName: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
    invoiceNumber: string;
  }>;
}> {
  const movements = await prisma.stockMovement.findMany({
    where: {
      type: StockMovementType.VENTA,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      product: {
        select: { id: true, name: true },
      },
      invoice: {
        select: { invoiceNumber: true },
      },
    },
    orderBy: { date: 'desc' },
  });

  let totalCMV = 0;

  const result = movements.map((m) => {
    const totalCost = Number(m.totalCost);
    totalCMV += totalCost;

    return {
      date: m.date,
      productId: m.product.id,
      productName: m.product.name,
      quantity: Math.abs(m.quantity), // Convert to positive for display
      unitCost: Number(m.unitCost),
      totalCost,
      invoiceNumber: m.invoice?.invoiceNumber || 'N/A',
    };
  });

  return {
    totalCMV,
    movements: result,
  };
}

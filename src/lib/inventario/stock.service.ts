/**
 * Stock Management Service
 * Handles all stock movement operations
 */

import { prisma } from '@/lib/prisma';
import { StockMovementType, Prisma } from '@prisma/client';
import type {
  StockMovementCreateInput,
  StockAdjustmentInput,
  StockValidationItem,
  StockValidationResult,
  ProductStockHistory,
  StockMovementWithRelations,
} from './types';

/**
 * Create a manual stock movement (for purchases, manual adjustments, returns)
 */
export async function createManualStockMovement(
  data: StockMovementCreateInput,
  tx?: Prisma.TransactionClient
) {
  const client = tx || prisma;

  // Get product before the movement
  const product = await client.product.findUnique({
    where: { id: data.productId },
    select: { id: true, name: true, stockQuantity: true },
  });

  if (!product) {
    throw new Error(`Producto con ID ${data.productId} no encontrado`);
  }

  const stockBefore = product.stockQuantity;
  const stockAfter = stockBefore + data.quantity;

  // Validate that stock won't go negative
  if (stockAfter < 0) {
    throw new Error(
      `Stock insuficiente para ${product.name}. ` +
        `Stock actual: ${stockBefore}, Movimiento: ${data.quantity}, ` +
        `Resultado: ${stockAfter}`
    );
  }

  // Calculate total cost
  const totalCost = Math.abs(data.quantity) * data.unitCost;

  // Create the movement
  const movement = await client.stockMovement.create({
    data: {
      productId: data.productId,
      userId: data.userId,
      type: data.type,
      quantity: data.quantity,
      unitCost: data.unitCost,
      totalCost,
      currency: data.currency || 'ARS',
      stockBefore,
      stockAfter,
      reference: data.reference,
      notes: data.notes,
      date: data.date || new Date(),
      invoiceId: data.invoiceId,
    },
    include: {
      product: {
        select: { id: true, name: true, sku: true },
      },
      user: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  // Update product stock
  await client.product.update({
    where: { id: data.productId },
    data: { stockQuantity: stockAfter },
  });

  return movement;
}

/**
 * Validate stock availability for multiple items
 */
export async function validateStockAvailability(
  items: StockValidationItem[]
): Promise<StockValidationResult> {
  const errors: StockValidationResult['errors'] = [];

  for (const item of items) {
    const product = await prisma.product.findUnique({
      where: { id: item.productId },
      select: { id: true, name: true, stockQuantity: true },
    });

    if (!product) {
      errors.push({
        productId: item.productId,
        productName: 'Producto no encontrado',
        available: 0,
        required: item.quantity,
        message: `Producto con ID ${item.productId} no existe`,
      });
      continue;
    }

    if (product.stockQuantity < item.quantity) {
      errors.push({
        productId: item.productId,
        productName: product.name,
        available: product.stockQuantity,
        required: item.quantity,
        message:
          `Stock insuficiente para ${product.name}. ` +
          `Disponible: ${product.stockQuantity}, Requerido: ${item.quantity}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get product stock history
 */
export async function getProductStockHistory(
  productId: string,
  options?: {
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }
): Promise<ProductStockHistory> {
  const { startDate, endDate, limit = 100, offset = 0 } = options || {};

  // Get product info
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, stockQuantity: true },
  });

  if (!product) {
    throw new Error(`Producto con ID ${productId} no encontrado`);
  }

  // Build where clause
  const where: Prisma.StockMovementWhereInput = {
    productId,
    ...(startDate || endDate
      ? {
          date: {
            ...(startDate ? { gte: startDate } : {}),
            ...(endDate ? { lte: endDate } : {}),
          },
        }
      : {}),
  };

  // Get movements
  const movements = await prisma.stockMovement.findMany({
    where,
    orderBy: { date: 'desc' },
    take: limit,
    skip: offset,
    include: {
      user: {
        select: { name: true },
      },
      invoice: {
        select: { invoiceNumber: true },
      },
    },
  });

  return {
    productId: product.id,
    productName: product.name,
    currentStock: product.stockQuantity,
    movements: movements.map((m) => ({
      id: m.id,
      date: m.date,
      type: m.type,
      quantity: m.quantity,
      unitCost: Number(m.unitCost),
      totalCost: Number(m.totalCost),
      stockBefore: m.stockBefore,
      stockAfter: m.stockAfter,
      reference: m.reference,
      notes: m.notes,
      invoiceNumber: m.invoice?.invoiceNumber,
      userName: m.user.name,
    })),
  };
}

/**
 * Calculate current stock from movements (for verification)
 */
export async function calculateCurrentStock(productId: string): Promise<number> {
  const movements = await prisma.stockMovement.findMany({
    where: { productId },
    orderBy: { date: 'asc' },
    select: { quantity: true },
  });

  return movements.reduce((acc, m) => acc + m.quantity, 0);
}

/**
 * Get stock movements with filters
 */
export async function getStockMovements(
  filters?: {
    productId?: string;
    type?: StockMovementType;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }
): Promise<StockMovementWithRelations[]> {
  const { productId, type, startDate, endDate, limit = 100, offset = 0 } = filters || {};

  const where: Prisma.StockMovementWhereInput = {
    ...(productId ? { productId } : {}),
    ...(type ? { type } : {}),
    ...(startDate || endDate
      ? {
          date: {
            ...(startDate ? { gte: startDate } : {}),
            ...(endDate ? { lte: endDate } : {}),
          },
        }
      : {}),
  };

  const movements = await prisma.stockMovement.findMany({
    where,
    orderBy: { date: 'desc' },
    take: limit,
    skip: offset,
    include: {
      product: {
        select: { id: true, name: true, sku: true },
      },
      user: {
        select: { id: true, name: true, email: true },
      },
      invoice: {
        select: { id: true, invoiceNumber: true },
      },
      journalEntry: {
        select: { id: true, entryNumber: true, description: true },
      },
    },
  });

  return movements.map((m) => ({
    ...m,
    unitCost: Number(m.unitCost),
    totalCost: Number(m.totalCost),
  })) as StockMovementWithRelations[];
}

/**
 * Process stock adjustment (change stock to a specific quantity)
 */
export async function processStockAdjustment(
  data: StockAdjustmentInput
): Promise<StockMovementWithRelations> {
  return await prisma.$transaction(async (tx) => {
    // Get current product state
    const product = await tx.product.findUnique({
      where: { id: data.productId },
      select: { stockQuantity: true, name: true },
    });

    if (!product) {
      throw new Error(`Producto con ID ${data.productId} no encontrado`);
    }

    const currentStock = product.stockQuantity;
    const difference = data.newQuantity - currentStock;

    if (difference === 0) {
      throw new Error('El nuevo stock es igual al stock actual. No se requiere ajuste.');
    }

    // Determine movement type
    const type: StockMovementType =
      difference > 0 ? StockMovementType.AJUSTE_POSITIVO : StockMovementType.AJUSTE_NEGATIVO;

    // Get unit cost
    let unitCost = data.unitCost;
    if (!unitCost) {
      // Try to get last purchase cost
      const lastPurchase = await tx.stockMovement.findFirst({
        where: {
          productId: data.productId,
          type: { in: [StockMovementType.COMPRA, StockMovementType.AJUSTE_POSITIVO] },
        },
        orderBy: { date: 'desc' },
        select: { unitCost: true },
      });

      if (lastPurchase) {
        unitCost = Number(lastPurchase.unitCost);
      } else {
        // Fallback to product cost price
        const costPrice = await tx.productPrice.findFirst({
          where: {
            productId: data.productId,
            priceType: 'COST',
            OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
          },
          orderBy: { validFrom: 'desc' },
          select: { amount: true },
        });

        if (costPrice) {
          unitCost = Number(costPrice.amount);
        } else {
          throw new Error(
            `No se pudo determinar el costo del producto. ` +
              `Por favor, proporcione el costo unitario.`
          );
        }
      }
    }

    // Create movement
    const movement = await createManualStockMovement(
      {
        productId: data.productId,
        userId: data.userId,
        type,
        quantity: difference,
        unitCost,
        notes: `Ajuste de inventario: ${data.reason}`,
        reference: 'AJUSTE_MANUAL',
      },
      tx
    );

    return movement as unknown as StockMovementWithRelations;
  });
}

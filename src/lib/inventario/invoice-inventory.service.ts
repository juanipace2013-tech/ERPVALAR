/**
 * Invoice-Inventory Integration Service
 * Main orchestrator for invoice creation with automatic inventory and accounting
 */

import { prisma } from '@/lib/prisma';
import { StockMovementType, InvoiceStatus, Prisma } from '@prisma/client';
import { validateStockAvailability } from './stock.service';
import { calculateCMV, getProductNames } from './cmv.service';
import { createCMVJournalEntry } from '@/lib/contabilidad/journal-entry.helper';
import type { InvoiceWithInventoryResult } from './types';

/**
 * Invoice item for processing
 */
interface InvoiceItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate: number;
  subtotal: number;
  description?: string;
}

/**
 * Invoice data for creation with inventory
 */
interface InvoiceCreateWithInventoryInput {
  // Invoice basic data
  invoiceNumber: string;
  invoiceType: 'A' | 'B' | 'C' | 'E';
  customerId: string;
  userId: string;
  currency: 'ARS' | 'USD' | 'EUR';

  // Amounts
  subtotal: number;
  taxAmount: number;
  discount: number;
  total: number;

  // Dates
  issueDate: Date;
  dueDate: Date;

  // Optional fields
  quoteId?: string;
  notes?: string;

  // Items
  items: InvoiceItemInput[];
}

/**
 * Main function: Process invoice creation with inventory and accounting
 */
export async function processInvoiceCreationWithInventory(
  invoiceData: InvoiceCreateWithInventoryInput
): Promise<InvoiceWithInventoryResult> {
  // Validate input
  if (!invoiceData.items || invoiceData.items.length === 0) {
    throw new Error('La factura debe tener al menos un ítem');
  }

  return await prisma.$transaction(
    async (tx) => {
      // STEP 1: Validate stock availability
      const stockValidation = await validateStockAvailability(
        invoiceData.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        }))
      );

      if (!stockValidation.valid) {
        const errors = stockValidation.errors
          .map((e) => e.message)
          .join('\n');
        throw new Error(`Validación de stock falló:\n${errors}`);
      }

      // STEP 2: Calculate CMV
      const cmvData = await calculateCMV(
        invoiceData.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        tx
      );

      // STEP 3: Create Invoice
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: invoiceData.invoiceNumber,
          invoiceType: invoiceData.invoiceType,
          customerId: invoiceData.customerId,
          userId: invoiceData.userId,
          quoteId: invoiceData.quoteId,
          status: InvoiceStatus.AUTHORIZED, // Automatically authorize
          currency: invoiceData.currency,
          subtotal: invoiceData.subtotal,
          taxAmount: invoiceData.taxAmount,
          discount: invoiceData.discount,
          total: invoiceData.total,
          issueDate: invoiceData.issueDate,
          dueDate: invoiceData.dueDate,
          notes: invoiceData.notes,
          items: {
            create: invoiceData.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount || 0,
              taxRate: item.taxRate,
              subtotal: item.subtotal,
              description: item.description,
            })),
          },
        },
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                },
              },
            },
          },
          customer: {
            select: {
              id: true,
              name: true,
              cuit: true,
            },
          },
        },
      });

      // STEP 4: Create stock movements for each item
      const movements = [];

      for (let i = 0; i < invoice.items.length; i++) {
        const item = invoice.items[i];
        const cmvItem = cmvData.itemsCost[i];

        // Get current stock before movement
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { stockQuantity: true },
        });

        if (!product) {
          throw new Error(`Producto ${item.productId} no encontrado`);
        }

        const stockBefore = product.stockQuantity;
        const stockAfter = stockBefore - item.quantity;

        // Create stock movement (negative quantity for sale)
        const movement = await tx.stockMovement.create({
          data: {
            productId: item.productId,
            invoiceId: invoice.id,
            userId: invoiceData.userId,
            type: StockMovementType.VENTA,
            quantity: -item.quantity, // Negative for sale (outgoing)
            unitCost: cmvItem.unitCost,
            totalCost: cmvItem.totalCost,
            currency: invoiceData.currency,
            stockBefore,
            stockAfter,
            reference: invoiceData.invoiceNumber,
            notes: `Venta - Factura ${invoiceData.invoiceNumber}`,
            date: invoiceData.issueDate,
          },
        });

        movements.push(movement);

        // STEP 5: Update product stock using atomic decrement
        const updateResult = await tx.product.updateMany({
          where: {
            id: item.productId,
            stockQuantity: { gte: item.quantity }, // Extra safety check
          },
          data: {
            stockQuantity: { decrement: item.quantity },
          },
        });

        if (updateResult.count === 0) {
          throw new Error(
            `No se pudo actualizar el stock del producto ${item.product.name}. ` +
              `Posible condición de carrera o stock insuficiente.`
          );
        }
      }

      // STEP 6: Create CMV Journal Entry
      const journalEntry = await createCMVJournalEntry(tx, {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate,
        cmvAmount: cmvData.totalCMV,
        currency: cmvData.currency,
        userId: invoiceData.userId,
      });

      // STEP 7: Link journal entry to stock movements
      await tx.stockMovement.updateMany({
        where: {
          id: { in: movements.map((m) => m.id) },
        },
        data: {
          journalEntryId: journalEntry.id,
        },
      });

      // STEP 8: Create activity log
      await tx.activity.create({
        data: {
          type: 'INVOICE_CREATED',
          userId: invoiceData.userId,
          entityType: 'invoice',
          entityId: invoice.id,
          customerId: invoice.customerId,
          title: `Factura ${invoice.invoiceNumber} creada`,
          description:
            `Se descontó stock automáticamente y generó asiento CMV por ${cmvData.totalCMV.toFixed(2)} ${cmvData.currency}`,
          metadata: {
            cmvAmount: cmvData.totalCMV,
            itemsCount: invoice.items.length,
            journalEntryNumber: journalEntry.entryNumber,
          },
        },
      });

      // Return complete result
      return {
        invoice,
        movements,
        journalEntry,
      };
    },
    {
      maxWait: 10000, // 10 seconds max wait
      timeout: 30000, // 30 seconds timeout
    }
  );
}

/**
 * Validate invoice data before processing
 */
export async function validateInvoiceForInventory(
  invoiceData: InvoiceCreateWithInventoryInput
): Promise<{
  valid: boolean;
  errors: string[];
}> {
  const errors: string[] = [];

  // Validate items exist
  if (!invoiceData.items || invoiceData.items.length === 0) {
    errors.push('La factura debe tener al menos un ítem');
    return { valid: false, errors };
  }

  // Validate stock availability
  const stockValidation = await validateStockAvailability(
    invoiceData.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    }))
  );

  if (!stockValidation.valid) {
    errors.push(...stockValidation.errors.map((e) => e.message));
  }

  // Validate products have cost
  const productIds = invoiceData.items.map((item) => item.productId);
  try {
    await calculateCMV(
      invoiceData.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      }))
    );
  } catch (error) {
    errors.push(`Error calculando CMV: ${error instanceof Error ? error.message : 'Error desconocido'}`);
  }

  // Validate customer exists
  const customer = await prisma.customer.findUnique({
    where: { id: invoiceData.customerId },
    select: { id: true },
  });

  if (!customer) {
    errors.push(`Cliente con ID ${invoiceData.customerId} no encontrado`);
  }

  // Validate user exists
  const user = await prisma.user.findUnique({
    where: { id: invoiceData.userId },
    select: { id: true },
  });

  if (!user) {
    errors.push(`Usuario con ID ${invoiceData.userId} no encontrado`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get invoice summary with inventory impact (for preview before creation)
 */
export async function getInvoiceInventoryPreview(
  items: InvoiceItemInput[]
): Promise<{
  stockValidation: any;
  cmvCalculation: any;
  productsInfo: Array<{
    productId: string;
    productName: string;
    currentStock: number;
    requestedQuantity: number;
    remainingStock: number;
    unitCost: number;
    totalCost: number;
  }>;
}> {
  // Validate stock
  const stockValidation = await validateStockAvailability(
    items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    }))
  );

  // Calculate CMV
  const cmvCalculation = await calculateCMV(
    items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    }))
  );

  // Get product details
  const products = await prisma.product.findMany({
    where: { id: { in: items.map((item) => item.productId) } },
    select: { id: true, name: true, stockQuantity: true },
  });

  const productsInfo = items.map((item, index) => {
    const product = products.find((p) => p.id === item.productId);
    const cmvItem = cmvCalculation.itemsCost[index];

    return {
      productId: item.productId,
      productName: product?.name || 'Producto no encontrado',
      currentStock: product?.stockQuantity || 0,
      requestedQuantity: item.quantity,
      remainingStock: (product?.stockQuantity || 0) - item.quantity,
      unitCost: cmvItem.unitCost,
      totalCost: cmvItem.totalCost,
    };
  });

  return {
    stockValidation,
    cmvCalculation,
    productsInfo,
  };
}

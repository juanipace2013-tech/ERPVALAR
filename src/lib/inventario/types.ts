/**
 * Types for Inventory Module
 */

import { StockMovementType, Currency } from '@prisma/client';

/**
 * Interface for creating a stock movement
 */
export interface StockMovementCreateInput {
  productId: string;
  type: StockMovementType;
  quantity: number;
  unitCost: number;
  currency?: Currency;
  reference?: string;
  notes?: string;
  date?: Date;
  userId: string;
  invoiceId?: string;
}

/**
 * Interface for stock adjustment
 */
export interface StockAdjustmentInput {
  productId: string;
  newQuantity: number;
  reason: string;
  unitCost?: number;
  userId: string;
}

/**
 * Interface for CMV calculation result
 */
export interface CMVCalculation {
  totalCMV: number;
  currency: Currency;
  itemsCost: Array<{
    productId: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
  }>;
}

/**
 * Interface for stock validation
 */
export interface StockValidationItem {
  productId: string;
  quantity: number;
}

/**
 * Interface for stock validation result
 */
export interface StockValidationResult {
  valid: boolean;
  errors: Array<{
    productId: string;
    productName: string;
    available: number;
    required: number;
    message: string;
  }>;
}

/**
 * Interface for invoice creation with inventory
 */
export interface InvoiceWithInventoryResult {
  invoice: any; // Full invoice object
  movements: any[]; // StockMovement objects
  journalEntry: any; // JournalEntry object for CMV
}

/**
 * Interface for product stock history
 */
export interface ProductStockHistory {
  productId: string;
  productName: string;
  currentStock: number;
  movements: Array<{
    id: string;
    date: Date;
    type: StockMovementType;
    quantity: number;
    unitCost: number;
    totalCost: number;
    stockBefore: number;
    stockAfter: number;
    reference?: string | null;
    notes?: string | null;
    invoiceNumber?: string;
    userName: string;
  }>;
}

/**
 * Type for stock movement with relations
 */
export interface StockMovementWithRelations {
  id: string;
  productId: string;
  invoiceId?: string | null;
  userId: string;
  type: StockMovementType;
  quantity: number;
  unitCost: number;
  totalCost: number;
  currency: Currency;
  stockBefore: number;
  stockAfter: number;
  journalEntryId?: string | null;
  reference?: string | null;
  notes?: string | null;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
  product: {
    id: string;
    name: string;
    sku: string;
  };
  user: {
    id: string;
    name: string;
    email: string;
  };
  invoice?: {
    id: string;
    invoiceNumber: string;
  } | null;
  journalEntry?: {
    id: string;
    entryNumber: number;
    description: string;
  } | null;
}

/**
 * Zod validation schemas for Inventory Module
 */

import { z } from 'zod';
import { StockMovementType, Currency } from '@prisma/client';

/**
 * Schema for creating a stock movement
 */
export const stockMovementSchema = z.object({
  productId: z.string().min(1, 'ID de producto requerido'),
  type: z.nativeEnum(StockMovementType, {
    message: 'Tipo de movimiento inválido',
  }),
  quantity: z
    .number()
    .int('La cantidad debe ser un número entero')
    .refine((val) => val !== 0, {
      message: 'La cantidad no puede ser cero',
    }),
  unitCost: z.number().nonnegative('El costo unitario no puede ser negativo'),
  currency: z.nativeEnum(Currency).default(Currency.ARS),
  reference: z.string().optional(),
  notes: z.string().optional(),
  date: z.coerce.date().optional().default(() => new Date()),
  userId: z.string().min(1, 'ID de usuario requerido'),
  invoiceId: z.string().optional(),
});

/**
 * Schema for stock adjustment
 */
export const stockAdjustmentSchema = z.object({
  productId: z.string().min(1, 'ID de producto requerido'),
  newQuantity: z
    .number()
    .int('La cantidad debe ser un número entero')
    .nonnegative('La cantidad no puede ser negativa'),
  reason: z
    .string()
    .min(10, 'Debe especificar el motivo del ajuste (mínimo 10 caracteres)'),
  unitCost: z.number().positive('El costo unitario debe ser positivo').optional(),
  userId: z.string().min(1, 'ID de usuario requerido'),
});

/**
 * Schema for stock validation items
 */
export const stockValidationItemSchema = z.object({
  productId: z.string().min(1, 'ID de producto requerido'),
  quantity: z
    .number()
    .int('La cantidad debe ser un número entero')
    .positive('La cantidad debe ser positiva'),
});

/**
 * Schema for validating multiple items
 */
export const stockValidationSchema = z.object({
  items: z
    .array(stockValidationItemSchema)
    .min(1, 'Debe proporcionar al menos un ítem'),
});

/**
 * Schema for product stock query
 */
export const productStockQuerySchema = z.object({
  productId: z.string().min(1, 'ID de producto requerido'),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(1000).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/**
 * Schema for stock movement query
 */
export const stockMovementQuerySchema = z.object({
  productId: z.string().optional(),
  type: z.nativeEnum(StockMovementType).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(1000).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/**
 * Type exports
 */
export type StockMovementInput = z.infer<typeof stockMovementSchema>;
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type StockValidationItem = z.infer<typeof stockValidationItemSchema>;
export type StockValidationInputs = z.infer<typeof stockValidationSchema>;
export type ProductStockQuery = z.infer<typeof productStockQuerySchema>;
export type StockMovementQuery = z.infer<typeof stockMovementQuerySchema>;

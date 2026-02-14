import { z } from 'zod'
import { validateCUIT } from './utils'

// ========================================
// AUTENTICACIÓN
// ========================================

export const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
})

export type LoginInput = z.infer<typeof loginSchema>

// ========================================
// CLIENTES
// ========================================

export const customerSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  businessName: z.string().optional(),
  type: z.enum(['COMPANY', 'INDIVIDUAL']),

  // Datos fiscales
  cuit: z
    .string()
    .min(11, 'El CUIT debe tener 11 dígitos')
    .max(13, 'El CUIT es inválido')
    .refine(
      (val) => validateCUIT(val),
      'El CUIT ingresado no es válido'
    ),
  taxCondition: z.enum([
    'RESPONSABLE_INSCRIPTO',
    'MONOTRIBUTO',
    'EXENTO',
    'CONSUMIDOR_FINAL',
    'NO_RESPONSABLE',
    'RESPONSABLE_NO_INSCRIPTO',
  ]),

  // Contacto
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  website: z.string().url('URL inválida').optional().or(z.literal('')),

  // Dirección
  address: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().default('Argentina'),

  // Configuración comercial
  status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']).default('ACTIVE'),
  creditLimit: z.number().nonnegative('El límite debe ser positivo').optional(),
  creditCurrency: z.enum(['ARS', 'USD', 'EUR']).optional(),
  paymentTerms: z.number().int().nonnegative('Los días deben ser positivos').optional(),
  discount: z
    .number()
    .min(0, 'El descuento no puede ser negativo')
    .max(100, 'El descuento no puede ser mayor a 100')
    .optional(),

  // Notas
  notes: z.string().optional(),
})

export type CustomerInput = z.infer<typeof customerSchema>

// ========================================
// CONTACTOS
// ========================================

export const contactSchema = z.object({
  firstName: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  lastName: z.string().min(2, 'El apellido debe tener al menos 2 caracteres'),
  position: z.string().optional(),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  isPrimary: z.boolean().default(false),
  notes: z.string().optional(),
})

export type ContactInput = z.infer<typeof contactSchema>

// ========================================
// PRODUCTOS
// ========================================

export const productSchema = z.object({
  // Identificación
  sku: z
    .string()
    .min(2, 'El SKU debe tener al menos 2 caracteres')
    .regex(/^[A-Z0-9-]+$/, 'El SKU solo puede contener letras mayúsculas, números y guiones'),
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  description: z.string().nullable().optional(),

  // Tipo de producto
  type: z.enum(['PRODUCT', 'SERVICE', 'COMBO']).default('PRODUCT'),

  // Categorización
  categoryId: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),

  // Stock
  stockQuantity: z.number().int().nonnegative('El stock no puede ser negativo'),
  minStock: z.number().int().nonnegative('El stock mínimo no puede ser negativo'),
  maxStock: z.number().int().positive('El stock máximo debe ser positivo').nullable().optional(),
  unit: z.string().default('UN'),

  // Costos
  lastCost: z.number().nonnegative('El costo no puede ser negativo').nullable().optional(),
  averageCost: z.number().nonnegative('El costo promedio no puede ser negativo').nullable().optional(),

  // Configuración
  status: z.enum(['ACTIVE', 'INACTIVE', 'DISCONTINUED']).default('ACTIVE'),
  isTaxable: z.boolean().default(true),
  taxRate: z.number().min(0).max(100).default(21),
  trackInventory: z.boolean().default(true),
  allowNegative: z.boolean().default(false),

  // Imágenes
  images: z.array(z.string().url()).default([]),

  // Notas
  notes: z.string().nullable().optional(),
})

export type ProductInput = z.infer<typeof productSchema>

export const productPriceSchema = z.object({
  currency: z.enum(['ARS', 'USD', 'EUR']),
  priceType: z.enum(['COST', 'SALE', 'LIST', 'WHOLESALE']),
  amount: z.number().positive('El precio debe ser positivo'),
  validFrom: z.union([z.date(), z.string()]).optional().transform((val) => {
    if (typeof val === 'string') return new Date(val)
    return val
  }),
  validUntil: z.union([z.date(), z.string()]).optional().transform((val) => {
    if (typeof val === 'string') return new Date(val)
    return val
  }),
})

export type ProductPriceInput = z.infer<typeof productPriceSchema>

export const productWithPricesSchema = productSchema.extend({
  prices: z.array(productPriceSchema).optional(),
})

export type ProductWithPricesInput = z.infer<typeof productWithPricesSchema>

// ========================================
// CATEGORÍAS
// ========================================

export const categorySchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  description: z.string().optional(),
  parentId: z.string().optional(),
})

export type CategoryInput = z.infer<typeof categorySchema>

// ========================================
// OPORTUNIDADES
// ========================================

export const opportunitySchema = z.object({
  customerId: z.string().min(1, 'Debe seleccionar un cliente'),
  userId: z.string().min(1, 'Debe seleccionar un vendedor'),

  title: z.string().min(3, 'El título debe tener al menos 3 caracteres'),
  description: z.string().optional(),

  stage: z.enum(['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST']).default('LEAD'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),

  estimatedValue: z.number().positive('El valor debe ser positivo').optional(),
  currency: z.enum(['ARS', 'USD', 'EUR']).default('ARS'),
  probability: z.number().int().min(0).max(100).optional(),

  expectedCloseDate: z.date().optional(),
  closedDate: z.date().optional(),
  lostReason: z.string().optional(),
})

export type OpportunityInput = z.infer<typeof opportunitySchema>

// ========================================
// COTIZACIONES
// ========================================

export const quoteItemSchema = z.object({
  productId: z.string().min(1, 'Debe seleccionar un producto'),
  quantity: z.number().int().positive('La cantidad debe ser positiva'),
  unitPrice: z.number().positive('El precio debe ser positivo'),
  discount: z.number().min(0).max(100).default(0),
  taxRate: z.number().min(0).max(100),
  description: z.string().optional(),
})

export type QuoteItemInput = z.infer<typeof quoteItemSchema>

export const quoteSchema = z.object({
  customerId: z.string().min(1, 'Debe seleccionar un cliente'),
  opportunityId: z.string().optional(),
  userId: z.string().min(1, 'Debe seleccionar un vendedor'),

  status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']).default('DRAFT'),
  currency: z.enum(['ARS', 'USD', 'EUR']).default('ARS'),

  validUntil: z.date(),
  notes: z.string().optional(),
  terms: z.string().optional(),

  items: z.array(quoteItemSchema).min(1, 'Debe agregar al menos un producto'),
})

export type QuoteInput = z.infer<typeof quoteSchema>

// ========================================
// TIPOS DE CAMBIO
// ========================================

export const exchangeRateSchema = z.object({
  fromCurrency: z.enum(['ARS', 'USD', 'EUR']),
  toCurrency: z.enum(['ARS', 'USD', 'EUR']),
  rate: z.number().positive('El tipo de cambio debe ser positivo'),
  source: z.enum(['MANUAL', 'BANCO_CENTRAL', 'API']).default('MANUAL'),
  validFrom: z.date().optional(),
  validUntil: z.date().optional(),
}).refine(
  (data) => data.fromCurrency !== data.toCurrency,
  'Las monedas deben ser diferentes'
)

export type ExchangeRateInput = z.infer<typeof exchangeRateSchema>

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { productWithPricesSchema } from '@/lib/validations'
import { z } from 'zod'

/**
 * POST /api/inventario/importar
 * Import multiple products from CSV/Excel
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json()
    const { products } = body

    if (!Array.isArray(products) || products.length === 0) {
      return NextResponse.json(
        { error: 'Debe proporcionar un array de productos' },
        { status: 400 }
      )
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as Array<{ sku: string; error: string }>,
    }

    // Process each product
    for (const productData of products) {
      try {
        // Validate product data
        const validatedData = productWithPricesSchema.parse(productData)

        // Check if SKU already exists
        const existingProduct = await prisma.product.findUnique({
          where: { sku: validatedData.sku },
        })

        if (existingProduct) {
          results.failed++
          results.errors.push({
            sku: validatedData.sku,
            error: 'SKU ya existe',
          })
          continue
        }

        // Create product
        await prisma.product.create({
          data: {
            sku: validatedData.sku,
            name: validatedData.name,
            description: validatedData.description,
            type: validatedData.type,
            categoryId: validatedData.categoryId,
            brand: validatedData.brand,
            stockQuantity: validatedData.stockQuantity,
            minStock: validatedData.minStock,
            maxStock: validatedData.maxStock,
            unit: validatedData.unit,
            lastCost: validatedData.lastCost,
            averageCost: validatedData.averageCost,
            status: validatedData.status,
            isTaxable: validatedData.isTaxable,
            taxRate: validatedData.taxRate,
            trackInventory: validatedData.trackInventory,
            allowNegative: validatedData.allowNegative,
            notes: validatedData.notes,
            prices: validatedData.prices
              ? {
                  create: validatedData.prices.map((price) => ({
                    currency: price.currency,
                    priceType: price.priceType,
                    amount: price.amount,
                    validFrom: price.validFrom || new Date(),
                    validUntil: price.validUntil,
                  })),
                }
              : undefined,
          },
        })

        results.success++
      } catch (error) {
        results.failed++
        if (error instanceof z.ZodError) {
          results.errors.push({
            sku: productData.sku || 'unknown',
            error: error.issues.map(e => e.message).join(', '),
          })
        } else {
          results.errors.push({
            sku: productData.sku || 'unknown',
            error: error instanceof Error ? error.message : 'Error desconocido',
          })
        }
      }
    }

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'PRODUCT_CREATED',
        userId: session.user.id,
        entityType: 'product',
        entityId: '',
        title: `Importación de productos`,
        description: `Se importaron ${results.success} productos exitosamente. ${results.failed} fallidos.`,
      },
    })

    return NextResponse.json(results, { status: 201 })
  } catch (error) {
    console.error('Error importing products:', error)
    return NextResponse.json(
      { error: 'Error al importar productos' },
      { status: 500 }
    )
  }
}

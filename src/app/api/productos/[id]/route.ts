import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { productWithPricesSchema } from '@/lib/validations'
import { z } from 'zod'

// GET /api/productos/[id] - Obtener producto por ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        prices: {
          orderBy: {
            validFrom: 'desc',
          },
        },
      },
    })

    if (!product) {
      return NextResponse.json(
        { error: 'Producto no encontrado' },
        { status: 404 }
      )
    }

    return NextResponse.json(product)
  } catch (error) {
    console.error('Error fetching product:', error)
    return NextResponse.json(
      { error: 'Error al obtener producto' },
      { status: 500 }
    )
  }
}

// PUT /api/productos/[id] - Actualizar producto
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()

    // Validar datos
    const validatedData = productWithPricesSchema.parse(body)

    // Verificar si el producto existe
    const existingProduct = await prisma.product.findUnique({
      where: { id },
    })

    if (!existingProduct) {
      return NextResponse.json(
        { error: 'Producto no encontrado' },
        { status: 404 }
      )
    }

    // Verificar si el SKU ya existe en otro producto
    if (validatedData.sku !== existingProduct.sku) {
      const skuExists = await prisma.product.findFirst({
        where: {
          sku: validatedData.sku,
          id: { not: id },
        },
      })

      if (skuExists) {
        return NextResponse.json(
          { error: 'Ya existe otro producto con este SKU' },
          { status: 400 }
        )
      }
    }

    // Actualizar producto
    const product = await prisma.product.update({
      where: { id },
      data: {
        sku: validatedData.sku,
        name: validatedData.name,
        description: validatedData.description,
        categoryId: validatedData.categoryId,
        brand: validatedData.brand,
        stockQuantity: validatedData.stockQuantity,
        minStock: validatedData.minStock,
        maxStock: validatedData.maxStock,
        unit: validatedData.unit,
        status: validatedData.status,
        isTaxable: validatedData.isTaxable,
        taxRate: validatedData.taxRate,
        notes: validatedData.notes,
      },
      include: {
        prices: true,
        category: true,
      },
    })

    // Si se proporcionaron precios, actualizar
    if (validatedData.prices && validatedData.prices.length > 0) {
      // Marcar precios anteriores como vencidos
      await prisma.productPrice.updateMany({
        where: {
          productId: id,
          validUntil: null,
        },
        data: {
          validUntil: new Date(),
        },
      })

      // Crear nuevos precios
      await prisma.productPrice.createMany({
        data: validatedData.prices.map((price) => ({
          productId: id,
          currency: price.currency,
          priceType: price.priceType,
          amount: price.amount,
          validFrom: price.validFrom || new Date(),
          validUntil: price.validUntil,
        })),
      })
    }

    // Registrar actividad
    await prisma.activity.create({
      data: {
        type: 'PRODUCT_UPDATED',
        userId: session.user.id,
        entityType: 'product',
        entityId: product.id,
        title: `Producto actualizado: ${product.name}`,
        description: `Se actualizó el producto ${product.name} (SKU: ${product.sku})`,
      },
    })

    // Obtener producto actualizado con precios
    const updatedProduct = await prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        prices: {
          where: {
            OR: [
              { validUntil: null },
              { validUntil: { gte: new Date() } },
            ],
          },
          orderBy: {
            validFrom: 'desc',
          },
        },
      },
    })

    return NextResponse.json(updatedProduct)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: error.issues },
        { status: 400 }
      )
    }

    console.error('Error updating product:', error)
    return NextResponse.json(
      { error: 'Error al actualizar producto' },
      { status: 500 }
    )
  }
}

// DELETE /api/productos/[id] - Eliminar producto
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params

    // Solo ADMIN puede eliminar productos
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'No tienes permisos para eliminar productos' },
        { status: 403 }
      )
    }

    // Verificar si el producto existe
    const product = await prisma.product.findUnique({
      where: { id },
    })

    if (!product) {
      return NextResponse.json(
        { error: 'Producto no encontrado' },
        { status: 404 }
      )
    }

    // Verificar si tiene datos relacionados
    const [quoteItemsCount, invoiceItemsCount] = await Promise.all([
      prisma.quoteItem.count({ where: { productId: id } }),
      prisma.invoiceItem.count({ where: { productId: id } }),
    ])

    if (quoteItemsCount > 0 || invoiceItemsCount > 0) {
      return NextResponse.json(
        {
          error:
            'No se puede eliminar el producto porque tiene cotizaciones o facturas asociadas',
        },
        { status: 400 }
      )
    }

    // Eliminar producto (cascade eliminará precios)
    await prisma.product.delete({
      where: { id },
    })

    // Registrar actividad
    await prisma.activity.create({
      data: {
        type: 'PRODUCT_DELETED',
        userId: session.user.id,
        entityType: 'product',
        entityId: product.id,
        title: `Producto eliminado: ${product.name}`,
        description: `Se eliminó el producto ${product.name} (SKU: ${product.sku})`,
      },
    })

    return NextResponse.json({ message: 'Producto eliminado exitosamente' })
  } catch (error) {
    console.error('Error deleting product:', error)
    return NextResponse.json(
      { error: 'Error al eliminar producto' },
      { status: 500 }
    )
  }
}

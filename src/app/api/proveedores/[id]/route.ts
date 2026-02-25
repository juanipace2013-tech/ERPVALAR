import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

// GET /api/proveedores/[id] - Obtener proveedor por ID
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

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: {
        buyerUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        _count: {
          select: {
            products: true,
          },
        },
      },
    })

    if (!supplier) {
      return NextResponse.json(
        { error: 'Proveedor no encontrado' },
        { status: 404 }
      )
    }

    return NextResponse.json(supplier)
  } catch (error) {
    console.error('Error fetching supplier:', error)
    return NextResponse.json(
      { error: 'Error al obtener proveedor' },
      { status: 500 }
    )
  }
}

// PUT /api/proveedores/[id] - Actualizar proveedor
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

    // Verificar que el proveedor existe
    const existingSupplier = await prisma.supplier.findUnique({
      where: { id },
    })

    if (!existingSupplier) {
      return NextResponse.json(
        { error: 'Proveedor no encontrado' },
        { status: 404 }
      )
    }

    // Validar CUIT único si se está cambiando
    if (body.taxId && body.taxId !== existingSupplier.taxId) {
      const duplicateTaxId = await prisma.supplier.findFirst({
        where: {
          taxId: body.taxId,
          id: { not: id },
        },
      })

      if (duplicateTaxId) {
        return NextResponse.json(
          { error: 'Ya existe otro proveedor con este CUIT' },
          { status: 400 }
        )
      }
    }

    // Actualizar proveedor
    const updatedSupplier = await prisma.supplier.update({
      where: { id },
      data: {
        name: body.name,
        legalName: body.legalName || null,
        taxId: body.taxId || null,
        email: body.email || null,
        phone: body.phone || null,
        mobile: body.mobile || null,
        address: body.address || null,
        city: body.city || null,
        province: body.province || null,
        postalCode: body.postalCode || null,
        website: body.website || null,
        discount: body.discount !== undefined ? body.discount : existingSupplier.discount,
        paymentDays: body.paymentDays !== undefined ? body.paymentDays : existingSupplier.paymentDays,
        category: body.category || null,
        brands: body.brands || [],
        status: body.status || existingSupplier.status,
        isPreferred: body.isPreferred !== undefined ? body.isPreferred : existingSupplier.isPreferred,
        paymentTerms: body.paymentTerms || null,
        accountNumber: body.accountNumber || null,
        notes: body.notes || null,
        internalNotes: body.internalNotes || null,
        buyerUserId: body.buyerUserId || null,
      },
      include: {
        buyerUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        _count: {
          select: {
            products: true,
          },
        },
      },
    })

    return NextResponse.json(updatedSupplier)
  } catch (error) {
    console.error('Error updating supplier:', error)
    return NextResponse.json(
      { error: 'Error al actualizar proveedor' },
      { status: 500 }
    )
  }
}

// DELETE /api/proveedores/[id] - Eliminar proveedor (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Solo ADMIN puede eliminar
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'No tiene permisos para eliminar proveedores' },
        { status: 403 }
      )
    }

    const { id } = await params

    // Verificar que existe
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            products: true,
          },
        },
      },
    })

    if (!supplier) {
      return NextResponse.json(
        { error: 'Proveedor no encontrado' },
        { status: 404 }
      )
    }

    // Verificar si tiene productos asociados
    if (supplier._count.products > 0) {
      // Soft delete: cambiar estado a INACTIVE
      await prisma.supplier.update({
        where: { id },
        data: { status: 'INACTIVE' },
      })

      return NextResponse.json({
        message: 'Proveedor desactivado (tiene productos asociados)',
        status: 'INACTIVE',
      })
    }

    // Hard delete si no tiene relaciones
    await prisma.supplier.delete({
      where: { id },
    })

    return NextResponse.json({ message: 'Proveedor eliminado exitosamente' })
  } catch (error) {
    console.error('Error deleting supplier:', error)
    return NextResponse.json(
      { error: 'Error al eliminar proveedor' },
      { status: 500 }
    )
  }
}

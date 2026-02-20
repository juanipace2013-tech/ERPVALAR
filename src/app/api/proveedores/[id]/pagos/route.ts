import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { registerSupplierPayment } from '@/lib/payment-accounting'

// GET /api/proveedores/[id]/pagos - Obtener pagos de un proveedor
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

    const payments = await prisma.supplierPayment.findMany({
      where: { supplierId: id },
      orderBy: { paymentDate: 'desc' },
      include: {
        purchaseOrder: {
          select: {
            orderNumber: true,
          },
        },
        user: {
          select: {
            name: true,
          },
        },
      },
    })

    return NextResponse.json({ payments })
  } catch (error) {
    console.error('Error fetching supplier payments:', error)
    return NextResponse.json(
      { error: 'Error al obtener pagos' },
      { status: 500 }
    )
  }
}

// POST /api/proveedores/[id]/pagos - Registrar pago a proveedor
export async function POST(
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
    const supplier = await prisma.supplier.findUnique({
      where: { id },
    })

    if (!supplier) {
      return NextResponse.json(
        { error: 'Proveedor no encontrado' },
        { status: 404 }
      )
    }

    // Registrar pago con asiento contable automático
    const result = await registerSupplierPayment({
      supplierId: id,
      amount: body.amount,
      paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
      paymentMethod: body.method || 'TRANSFER',
      reference: body.reference,
      notes: body.notes,
      userId: session.user.id!,
      purchaseOrderId: body.purchaseOrderId,
    })

    // Obtener el pago con sus relaciones para la respuesta
    const payment = await prisma.supplierPayment.findUnique({
      where: { id: result.payment.id },
      include: {
        purchaseOrder: {
          select: {
            orderNumber: true,
          },
        },
        user: {
          select: {
            name: true,
          },
        },
      },
    })

    return NextResponse.json({
      payment,
      journalEntry: {
        id: result.journalEntry.id,
        entryNumber: result.journalEntry.entryNumber,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('Error creating payment:', error)
    return NextResponse.json(
      { error: 'Error al registrar pago' },
      { status: 500 }
    )
  }
}

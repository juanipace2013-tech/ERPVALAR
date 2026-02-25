import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

// GET /api/proveedores/[id]/movimientos - Obtener cuenta corriente del proveedor
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

    // Obtener órdenes de compra
    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: { supplierId: id },
      orderBy: { orderDate: 'desc' },
      include: {
        items: {
          include: {
            product: {
              select: {
                name: true,
                sku: true,
              },
            },
          },
        },
        user: {
          select: {
            name: true,
          },
        },
      },
    })

    // Obtener pagos
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

    // Combinar y ordenar movimientos
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const movements: any[] = []

    // Agregar órdenes de compra (débito - lo que debemos)
    for (const order of purchaseOrders) {
      movements.push({
        id: order.id,
        type: 'PURCHASE_ORDER',
        date: order.orderDate,
        reference: order.orderNumber,
        description: `Orden de Compra ${order.orderNumber}`,
        status: order.status,
        currency: order.currency,
        debit: Number(order.total), // Lo que debemos
        credit: 0,
        balance: 0, // Se calculará después
        items: order.items.map(item => ({
          product: `${item.product.sku} - ${item.product.name}`,
          quantity: item.quantity,
          unitCost: Number(item.unitCost),
          subtotal: Number(item.subtotal),
        })),
        user: order.user.name,
        paidAmount: Number(order.paidAmount),
        pendingAmount: Number(order.total) - Number(order.paidAmount),
      })
    }

    // Agregar pagos (crédito - lo que pagamos)
    for (const payment of payments) {
      movements.push({
        id: payment.id,
        type: 'PAYMENT',
        date: payment.paymentDate,
        reference: payment.reference || payment.id,
        description: payment.purchaseOrder
          ? `Pago de ${payment.purchaseOrder.orderNumber}`
          : 'Pago general',
        status: 'PAID',
        currency: payment.currency,
        debit: 0,
        credit: Number(payment.amount), // Lo que pagamos
        balance: 0,
        method: payment.method,
        notes: payment.notes,
        user: payment.user.name,
        purchaseOrderNumber: payment.purchaseOrder?.orderNumber,
      })
    }

    // Ordenar por fecha (más reciente primero)
    movements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    // Calcular balance acumulado (de más antiguo a más reciente para el cálculo)
    let runningBalance = 0
    for (let i = movements.length - 1; i >= 0; i--) {
      runningBalance += movements[i].debit - movements[i].credit
      movements[i].balance = runningBalance
    }

    // Calcular estadísticas
    const totalPurchases = purchaseOrders.reduce(
      (sum, order) => sum + Number(order.total),
      0
    )
    const totalPaid = payments.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0
    )
    const pendingOrders = purchaseOrders.filter(
      order => order.status === 'APPROVED' || order.status === 'RECEIVED'
    ).length

    const stats = {
      totalPurchases,
      totalPaid,
      currentBalance: totalPurchases - totalPaid,
      pendingOrders,
      totalOrders: purchaseOrders.length,
      totalPayments: payments.length,
    }

    return NextResponse.json({
      movements,
      stats,
    })
  } catch (error) {
    console.error('Error fetching supplier movements:', error)
    return NextResponse.json(
      { error: 'Error al obtener movimientos' },
      { status: 500 }
    )
  }
}

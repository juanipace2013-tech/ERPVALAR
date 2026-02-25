import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { registerCustomerReceipt } from '@/lib/payment-accounting'

// GET /api/clientes/[id]/cobros - Obtener cobros de un cliente
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

    const receipts = await prisma.customerReceipt.findMany({
      where: { customerId: id },
      orderBy: { receiptDate: 'desc' },
      include: {
        invoice: {
          select: {
            invoiceNumber: true,
          },
        },
        user: {
          select: {
            name: true,
          },
        },
      },
    })

    return NextResponse.json({ receipts })
  } catch (error) {
    console.error('Error fetching customer receipts:', error)
    return NextResponse.json(
      { error: 'Error al obtener cobros' },
      { status: 500 }
    )
  }
}

// POST /api/clientes/[id]/cobros - Registrar cobro a cliente
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

    // Verificar que el cliente existe
    const customer = await prisma.customer.findUnique({
      where: { id },
    })

    if (!customer) {
      return NextResponse.json(
        { error: 'Cliente no encontrado' },
        { status: 404 }
      )
    }

    // Registrar cobro con asiento contable automático
    const result = await registerCustomerReceipt({
      customerId: id,
      amount: body.amount,
      receiptDate: body.receiptDate ? new Date(body.receiptDate) : new Date(),
      paymentMethod: body.method || 'TRANSFER',
      reference: body.reference,
      notes: body.notes,
      userId: session.user.id!,
      invoiceId: body.invoiceId,
    })

    // Obtener el cobro con sus relaciones para la respuesta
    const receipt = await prisma.customerReceipt.findUnique({
      where: { id: result.receipt.id },
      include: {
        invoice: {
          select: {
            invoiceNumber: true,
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
      receipt,
      journalEntry: {
        id: result.journalEntry.id,
        entryNumber: result.journalEntry.entryNumber,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('Error creating receipt:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al registrar cobro' },
      { status: 500 }
    )
  }
}

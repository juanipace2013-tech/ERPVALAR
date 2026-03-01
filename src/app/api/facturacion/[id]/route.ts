import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'

const updateInvoiceSchema = z.object({
  userId: z.string().min(1, 'El vendedor es obligatorio'),
}).strict()

/**
 * PATCH /api/facturacion/[id]
 * Actualiza campos de una factura (ej: asignar vendedor)
 */
export async function PATCH(
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
    const validatedData = updateInvoiceSchema.parse(body)

    // Verificar que la factura existe
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { id: true },
    })

    if (!invoice) {
      return NextResponse.json(
        { error: 'Factura no encontrada' },
        { status: 404 }
      )
    }

    // Verificar que el usuario existe
    const user = await prisma.user.findUnique({
      where: { id: validatedData.userId },
      select: { id: true, name: true },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Usuario no encontrado' },
        { status: 404 }
      )
    }

    // Actualizar vendedor
    const updated = await prisma.invoice.update({
      where: { id },
      data: { userId: validatedData.userId },
      select: {
        id: true,
        user: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({
      success: true,
      salesPerson: updated.user,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: error.issues },
        { status: 400 }
      )
    }

    console.error('Error updating invoice:', error)
    return NextResponse.json(
      { error: 'Error al actualizar factura' },
      { status: 500 }
    )
  }
}

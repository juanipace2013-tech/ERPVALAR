import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { exchangeRateSchema } from '@/lib/validations'
import { z } from 'zod'

/**
 * GET /api/tipo-cambio/[id]
 * Obtiene un tipo de cambio específico
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params

    const exchangeRate = await prisma.exchangeRate.findUnique({
      where: { id },
    })

    if (!exchangeRate) {
      return NextResponse.json(
        { error: 'Tipo de cambio no encontrado' },
        { status: 404 }
      )
    }

    return NextResponse.json(exchangeRate)
  } catch (error) {
    console.error('Error fetching exchange rate:', error)
    return NextResponse.json(
      { error: 'Error al obtener tipo de cambio' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/tipo-cambio/[id]
 * Actualiza un tipo de cambio
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()

    // Verificar que el tipo de cambio existe
    const existingRate = await prisma.exchangeRate.findUnique({
      where: { id },
    })

    if (!existingRate) {
      return NextResponse.json(
        { error: 'Tipo de cambio no encontrado' },
        { status: 404 }
      )
    }

    // Preparar datos para validación
    const dataToValidate: any = {
      fromCurrency: body.fromCurrency,
      toCurrency: body.toCurrency,
      rate: body.rate,
      source: body.source,
    }

    // Solo incluir validFrom si existe
    if (body.validFrom) {
      dataToValidate.validFrom = new Date(body.validFrom)
    }

    // Solo incluir validUntil si existe y no es null
    if (body.validUntil && body.validUntil !== null) {
      dataToValidate.validUntil = new Date(body.validUntil)
    }

    // Validar datos
    const validatedData = exchangeRateSchema.parse(dataToValidate)

    // Actualizar tipo de cambio
    const exchangeRate = await prisma.exchangeRate.update({
      where: { id },
      data: {
        fromCurrency: validatedData.fromCurrency,
        toCurrency: validatedData.toCurrency,
        rate: validatedData.rate,
        source: validatedData.source,
        validFrom: validatedData.validFrom,
        validUntil: validatedData.validUntil,
      },
    })

    // Registrar actividad
    await prisma.activity.create({
      data: {
        type: 'EXCHANGE_RATE_UPDATED',
        userId: session.user.id,
        entityType: 'exchange_rate',
        entityId: exchangeRate.id,
        title: `Tipo de cambio actualizado: ${exchangeRate.fromCurrency}/${exchangeRate.toCurrency}`,
        description: `Se actualizó tipo de cambio ${exchangeRate.fromCurrency} a ${exchangeRate.toCurrency}: ${exchangeRate.rate}`,
      },
    })

    return NextResponse.json(exchangeRate)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Errores de validación',
          details: error.issues,
        },
        { status: 400 }
      )
    }

    console.error('Error updating exchange rate:', error)
    return NextResponse.json(
      { error: 'Error al actualizar tipo de cambio' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/tipo-cambio/[id]
 * Elimina un tipo de cambio
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params

    // Verificar que el tipo de cambio existe
    const existingRate = await prisma.exchangeRate.findUnique({
      where: { id },
    })

    if (!existingRate) {
      return NextResponse.json(
        { error: 'Tipo de cambio no encontrado' },
        { status: 404 }
      )
    }

    // Eliminar tipo de cambio
    await prisma.exchangeRate.delete({
      where: { id },
    })

    // Registrar actividad
    await prisma.activity.create({
      data: {
        type: 'EXCHANGE_RATE_DELETED',
        userId: session.user.id,
        entityType: 'exchange_rate',
        entityId: id,
        title: `Tipo de cambio eliminado: ${existingRate.fromCurrency}/${existingRate.toCurrency}`,
        description: `Se eliminó tipo de cambio ${existingRate.fromCurrency} a ${existingRate.toCurrency}`,
      },
    })

    return NextResponse.json({ success: true, message: 'Tipo de cambio eliminado' })
  } catch (error) {
    console.error('Error deleting exchange rate:', error)
    return NextResponse.json(
      { error: 'Error al eliminar tipo de cambio' },
      { status: 500 }
    )
  }
}

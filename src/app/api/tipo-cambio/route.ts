import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { exchangeRateSchema } from '@/lib/validations'
import { z } from 'zod'

/**
 * GET /api/tipo-cambio
 * Obtiene los tipos de cambio vigentes
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const fromCurrency = searchParams.get('from') || ''
    const toCurrency = searchParams.get('to') || ''
    const includeHistory = searchParams.get('history') === 'true'

    const now = new Date()

    // Construir filtros
    const where: Record<string, unknown> = {}

    if (fromCurrency) {
      where.fromCurrency = fromCurrency
    }

    if (toCurrency) {
      where.toCurrency = toCurrency
    }

    if (!includeHistory) {
      // Solo tipos de cambio vigentes
      where.validFrom = { lte: now }
      where.OR = [
        { validUntil: null },
        { validUntil: { gte: now } }
      ]
    }

    const exchangeRates = await prisma.exchangeRate.findMany({
      where,
      orderBy: [
        { validFrom: 'desc' },
        { createdAt: 'desc' }
      ],
      take: includeHistory ? undefined : 50,
    })

    // Agrupar por par de monedas y obtener el más reciente de cada uno
    const latestRates = new Map()

    for (const rate of exchangeRates) {
      const key = `${rate.fromCurrency}-${rate.toCurrency}`
      if (!latestRates.has(key)) {
        latestRates.set(key, rate)
      }
    }

    return NextResponse.json({
      rates: includeHistory ? exchangeRates : Array.from(latestRates.values()),
      count: latestRates.size,
    })
  } catch (error) {
    console.error('Error fetching exchange rates:', error)
    return NextResponse.json(
      { error: 'Error al obtener tipos de cambio' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/tipo-cambio
 * Crea un nuevo tipo de cambio manual
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json()

    console.log('📥 Datos recibidos para tipo de cambio:', body)

    // Preparar datos para validación
    const dataToValidate: Record<string, unknown> = {
      fromCurrency: body.fromCurrency,
      toCurrency: body.toCurrency,
      rate: body.rate,
      source: body.source,
      validFrom: body.validFrom ? new Date(body.validFrom) : new Date(),
    }

    // Solo incluir validUntil si existe y no es null
    if (body.validUntil && body.validUntil !== null) {
      dataToValidate.validUntil = new Date(body.validUntil)
    }

    // Validar datos
    const validatedData = exchangeRateSchema.parse(dataToValidate)

    // Verificar que no exista un tipo de cambio duplicado en el mismo período
    const existingRate = await prisma.exchangeRate.findFirst({
      where: {
        fromCurrency: validatedData.fromCurrency,
        toCurrency: validatedData.toCurrency,
        validFrom: validatedData.validFrom,
      },
    })

    if (existingRate) {
      return NextResponse.json(
        { error: 'Ya existe un tipo de cambio para esta fecha' },
        { status: 400 }
      )
    }

    // Crear tipo de cambio
    const exchangeRate = await prisma.exchangeRate.create({
      data: {
        fromCurrency: validatedData.fromCurrency,
        toCurrency: validatedData.toCurrency,
        rate: validatedData.rate,
        source: validatedData.source,
        validFrom: validatedData.validFrom!,
        validUntil: validatedData.validUntil,
      },
    })

    // Registrar actividad
    await prisma.activity.create({
      data: {
        type: 'EXCHANGE_RATE_CREATED',
        userId: session.user.id,
        entityType: 'exchange_rate',
        entityId: exchangeRate.id,
        title: `Tipo de cambio creado: ${exchangeRate.fromCurrency}/${exchangeRate.toCurrency}`,
        description: `Se creó tipo de cambio ${exchangeRate.fromCurrency} a ${exchangeRate.toCurrency}: ${exchangeRate.rate}`,
      },
    })

    console.log('✅ Tipo de cambio creado:', exchangeRate.id)

    return NextResponse.json(exchangeRate, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ ERROR DE VALIDACIÓN:', error.issues)
      const errorMessages = error.issues.map(err => {
        const field = err.path.join('.')
        return `Campo "${field}": ${err.message}`
      })

      return NextResponse.json(
        {
          error: 'Errores de validación',
          message: errorMessages.join(' | '),
          details: error.issues,
        },
        { status: 400 }
      )
    }

    console.error('❌ Error al crear tipo de cambio:', error)
    return NextResponse.json(
      {
        error: 'Error al crear tipo de cambio',
        message: error instanceof Error ? error.message : 'Error desconocido'
      },
      { status: 500 }
    )
  }
}

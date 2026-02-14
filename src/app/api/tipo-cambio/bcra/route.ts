import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getBCRAUSDRate } from '@/lib/bcra'

/**
 * GET /api/tipo-cambio/bcra
 * Obtiene el tipo de cambio USD del BCRA y lo guarda en la base de datos
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    console.log('🔄 Actualizando tipo de cambio desde BCRA...')

    // Obtener tipo de cambio del BCRA
    const bcraData = await getBCRAUSDRate()

    console.log('📊 Datos BCRA obtenidos:', bcraData)

    // Verificar si ya existe un tipo de cambio para esta fecha
    const existingRate = await prisma.exchangeRate.findFirst({
      where: {
        fromCurrency: 'USD',
        toCurrency: 'ARS',
        validFrom: bcraData.date,
        source: 'BANCO_CENTRAL',
      },
    })

    let exchangeRate

    if (existingRate) {
      // Actualizar el existente
      exchangeRate = await prisma.exchangeRate.update({
        where: { id: existingRate.id },
        data: {
          rate: bcraData.rate,
          updatedAt: new Date(),
        },
      })

      console.log('✅ Tipo de cambio actualizado:', exchangeRate.id)
    } else {
      // Crear nuevo
      exchangeRate = await prisma.exchangeRate.create({
        data: {
          fromCurrency: 'USD',
          toCurrency: 'ARS',
          rate: bcraData.rate,
          source: 'BANCO_CENTRAL',
          validFrom: bcraData.date,
        },
      })

      console.log('✅ Tipo de cambio creado:', exchangeRate.id)
    }

    // Registrar actividad
    await prisma.activity.create({
      data: {
        type: existingRate ? 'EXCHANGE_RATE_UPDATED' : 'EXCHANGE_RATE_CREATED',
        userId: session.user.id,
        entityType: 'exchange_rate',
        entityId: exchangeRate.id,
        title: 'Tipo de cambio actualizado desde BCRA',
        description: `Tipo de cambio USD/ARS actualizado: ${bcraData.rate} (Fecha: ${bcraData.date.toLocaleDateString('es-AR')})`,
      },
    })

    return NextResponse.json({
      success: true,
      exchangeRate,
      bcraData: {
        rate: bcraData.rate,
        date: bcraData.date,
        source: bcraData.source,
      },
      message: existingRate ? 'Tipo de cambio actualizado' : 'Tipo de cambio creado',
    })
  } catch (error) {
    console.error('❌ Error al obtener tipo de cambio del BCRA:', error)
    return NextResponse.json(
      {
        error: 'Error al obtener tipo de cambio del BCRA',
        message: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/tipo-cambio/bcra
 * Fuerza la actualización del tipo de cambio desde BCRA
 */
export async function POST(request: NextRequest) {
  return GET(request)
}

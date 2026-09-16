/**
 * POST /api/tipo-cambio/bna
 *
 * Fuerza la actualización del tipo de cambio desde el BNA (dólar billete
 * venta del día hábil anterior). Es el botón de la pantalla Tipo de Cambio;
 * el cron actualizar-tc-bna hace lo mismo solo cada mañana.
 */

import { logger } from '@/lib/logger'
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requireRole, ROLES } from '@/lib/authz'
import { actualizarTipoCambioBNA } from '@/lib/tipo-cambio-bna'

export async function POST(_request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const forbidden = requireRole(session, ROLES.FINANZAS)
    if (forbidden) return forbidden

    const resultado = await actualizarTipoCambioBNA()

    if (resultado.accion === 'creado' || resultado.accion === 'actualizado') {
      await prisma.activity.create({
        data: {
          type: resultado.accion === 'creado' ? 'EXCHANGE_RATE_CREATED' : 'EXCHANGE_RATE_UPDATED',
          userId: session.user.id,
          entityType: 'exchange_rate',
          entityId: resultado.exchangeRateId,
          title: 'Tipo de cambio actualizado desde BNA',
          description: `Dólar billete venta BNA del ${resultado.fechaCotizacion}: $${resultado.rate}`,
        },
      })
    }

    const mensajes: Record<typeof resultado.accion, string> = {
      creado: 'Tipo de cambio creado',
      actualizado: 'Tipo de cambio actualizado',
      sin_cambios: 'El tipo de cambio ya estaba al día',
      respetado_manual: 'Ya hay un tipo de cambio manual para esa fecha; no se modificó',
    }

    return NextResponse.json({
      success: true,
      ...resultado,
      message: mensajes[resultado.accion],
    })
  } catch (error) {
    logger.error('❌ Error al actualizar tipo de cambio desde BNA:', error)
    return NextResponse.json(
      {
        error: 'Error al actualizar tipo de cambio desde BNA',
        message: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 }
    )
  }
}

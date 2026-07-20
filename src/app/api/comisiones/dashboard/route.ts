import { NextRequest, NextResponse } from 'next/server'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { VENDEDOR_SELECCIONABLE } from '@/lib/vendedores'
import { pipelineCerrado, resumenMes } from '@/lib/comisiones/liquidacion'

// GET /api/comisiones/dashboard?vendedorId=&anio=&mes=
// Resumen del vendedor: mes en curso (facturado, tramo, comisión provisoria),
// pipeline cerrado sin facturar (solo USD) y las liquidaciones existentes.
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const hoy = new Date()
    const anio = Number(searchParams.get('anio')) || hoy.getFullYear()
    const mes = Number(searchParams.get('mes')) || hoy.getMonth() + 1

    const vendedores = await prisma.user.findMany({
      where: VENDEDOR_SELECCIONABLE,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    const vendedorId = searchParams.get('vendedorId') || vendedores[0]?.id
    if (!vendedorId) {
      return NextResponse.json({ vendedores: [], vendedorId: null })
    }

    const [resumen, pipeline, liquidaciones, config] = await Promise.all([
      resumenMes(vendedorId, anio, mes),
      pipelineCerrado(vendedorId),
      prisma.comisionLiquidacion.findMany({
        where: { vendedorId },
        orderBy: [{ anio: 'desc' }, { mes: 'desc' }],
        include: { _count: { select: { lineas: true } } },
      }),
      prisma.vendedorComisionConfig.findUnique({ where: { vendedorId } }),
    ])

    return NextResponse.json({
      vendedores,
      vendedorId,
      anio,
      mes,
      resumen,
      pipeline,
      liquidaciones,
      basicoArs: config ? Number(config.basicoArs) : null,
    })
  } catch (e) {
    logger.error('[comisiones/dashboard] GET error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

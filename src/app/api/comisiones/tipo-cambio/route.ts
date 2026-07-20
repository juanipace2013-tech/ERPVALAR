import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

// GET /api/comisiones/tipo-cambio?anio=2026 — TCs mensuales del año.
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const anio = Number(searchParams.get('anio')) || new Date().getFullYear()
    const tipos = await prisma.tipoCambioMes.findMany({
      where: { anio },
      orderBy: { mes: 'asc' },
    })
    return NextResponse.json({ anio, tipos })
  } catch (e) {
    logger.error('[comisiones/tipo-cambio] GET error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

const putSchema = z.object({
  anio: z.number().int().min(2020).max(2100),
  mes: z.number().int().min(1).max(12),
  billete: z.number().positive(),
  divisa: z.number().positive(),
})

// PUT /api/comisiones/tipo-cambio — upsert del TC de un mes.
export async function PUT(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const parsed = putSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Body inválido', detalles: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { anio, mes, billete, divisa } = parsed.data
    const tc = await prisma.tipoCambioMes.upsert({
      where: { anio_mes: { anio, mes } },
      create: { anio, mes, billete, divisa },
      update: { billete, divisa },
    })
    return NextResponse.json({ tc })
  } catch (e) {
    logger.error('[comisiones/tipo-cambio] PUT error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

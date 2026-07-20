import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/auth'
import { logger } from '@/lib/logger'
import { abrirYSincronizar } from '@/lib/comisiones/liquidacion'

const postSchema = z.object({
  vendedorId: z.string().min(1),
  anio: z.number().int().min(2020).max(2100),
  mes: z.number().int().min(1).max(12),
})

// POST /api/comisiones/liquidaciones — abre (o retoma) la liquidación del mes
// y sincroniza sus líneas con las facturas parciales del período.
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const parsed = postSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Body inválido', detalles: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { vendedorId, anio, mes } = parsed.data
    const liquidacion = await abrirYSincronizar(vendedorId, anio, mes)
    return NextResponse.json({ liquidacion })
  } catch (e) {
    logger.error('[comisiones/liquidaciones] POST error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { requireExirosAgent } from '@/lib/exiros/agent-auth'

// Cola de acciones para el agente Python de Exiros.
// GET  — devuelve las licitaciones encoladas para declinar: [{numero, idInterno}].
// PATCH — el agente reporta el resultado del decline ejecutado en el portal.
// Auth: Bearer EXIROS_AGENT_API_KEY.

export async function GET(req: NextRequest) {
  const authError = requireExirosAgent(req)
  if (authError) return authError

  try {
    const pendientes = await prisma.exirosLicitacion.findMany({
      where: { estado: 'DECLINAR_PENDIENTE' },
      select: { numero: true, idInterno: true },
      orderBy: { updatedAt: 'asc' },
    })
    return NextResponse.json(pendientes)
  } catch (e) {
    logger.error('[exiros/acciones] GET error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

const resultadoSchema = z.object({
  numero: z.string().min(1),
  resultado: z.enum(['DECLINADA', 'DECLINE_ERROR']),
  mensaje: z.string().nullish(),
})

export async function PATCH(req: NextRequest) {
  const authError = requireExirosAgent(req)
  if (authError) return authError

  try {
    const parsed = resultadoSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Body inválido', detalles: parsed.error.flatten() },
        { status: 400 }
      )
    }
    const { numero, resultado, mensaje } = parsed.data

    const existing = await prisma.exirosLicitacion.findUnique({
      where: { numero },
      select: { id: true, estado: true },
    })
    if (!existing) {
      return NextResponse.json({ error: `Licitación ${numero} no encontrada` }, { status: 404 })
    }

    // Se actualiza aunque el usuario haya cancelado mientras tanto: si el
    // agente reporta, el decline ya se ejecutó (o falló) en el portal y el
    // ERP tiene que reflejar la realidad.
    await prisma.exirosLicitacion.update({
      where: { id: existing.id },
      data: { estado: resultado, declineMsg: mensaje ?? null },
    })

    return NextResponse.json({ ok: true, numero, estado: resultado })
  } catch (e) {
    logger.error('[exiros/acciones] PATCH error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

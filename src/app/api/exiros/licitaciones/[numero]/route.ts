import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { UI_TRANSICIONES, EXIROS_ESTADOS } from '@/lib/exiros/constants'

// PATCH /api/exiros/licitaciones/[numero] — cambio de estado desde la UI.
// Transiciones válidas en UI_TRANSICIONES; DECLINAR_PENDIENTE encola el
// decline para que lo ejecute el agente, "NUEVA" deshace.

const patchSchema = z.object({
  estado: z.enum(EXIROS_ESTADOS),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ numero: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { numero } = await params
    const parsed = patchSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Body inválido', detalles: parsed.error.flatten() },
        { status: 400 }
      )
    }
    const nuevoEstado = parsed.data.estado

    const lic = await prisma.exirosLicitacion.findUnique({
      where: { numero },
      select: { id: true, estado: true },
    })
    if (!lic) {
      return NextResponse.json({ error: `Licitación ${numero} no encontrada` }, { status: 404 })
    }

    const permitidas = UI_TRANSICIONES[lic.estado] || []
    if (!permitidas.includes(nuevoEstado)) {
      return NextResponse.json(
        { error: `Transición no permitida: ${lic.estado} → ${nuevoEstado}` },
        { status: 409 }
      )
    }

    const updated = await prisma.exirosLicitacion.update({
      where: { id: lic.id },
      // Al volver a NUEVA limpiamos el resultado de un decline anterior.
      data: { estado: nuevoEstado, ...(nuevoEstado === 'NUEVA' ? { declineMsg: null } : {}) },
    })

    return NextResponse.json({ ok: true, numero, estado: updated.estado })
  } catch (e) {
    logger.error('[exiros/licitaciones/[numero]] PATCH error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

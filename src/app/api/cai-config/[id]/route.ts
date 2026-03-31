import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

const caiConfigUpdateSchema = z.object({
  pointOfSale: z.number().int().positive().optional(),
  caiNumber: z.string().min(1).optional(),
  caiExpirationDate: z.string().min(1).optional(),
  startNumber: z.number().int().positive().optional(),
  endNumber: z.number().int().positive().optional(),
  lastUsedNumber: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
})

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const validated = caiConfigUpdateSchema.parse(body)

    // Si se activa, desactivar las demás del mismo PV
    if (validated.active === true) {
      const existing = await prisma.caiConfig.findUnique({ where: { id: params.id } })
      if (existing) {
        await prisma.caiConfig.updateMany({
          where: { pointOfSale: existing.pointOfSale, active: true, NOT: { id: params.id } },
          data: { active: false },
        })
      }
    }

    const updateData: Record<string, unknown> = { ...validated }
    if (validated.caiExpirationDate) {
      updateData.caiExpirationDate = new Date(validated.caiExpirationDate)
    }

    const config = await prisma.caiConfig.update({
      where: { id: params.id },
      data: updateData,
    })

    return NextResponse.json(config)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Datos inválidos', details: error.issues }, { status: 400 })
    }
    logger.error('Error updating CAI config:', error)
    return NextResponse.json({ error: 'Error al actualizar configuración de CAI' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    await prisma.caiConfig.delete({ where: { id: params.id } })

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error('Error deleting CAI config:', error)
    return NextResponse.json({ error: 'Error al eliminar configuración de CAI' }, { status: 500 })
  }
}

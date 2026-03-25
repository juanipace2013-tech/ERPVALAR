import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'

const caiConfigSchema = z.object({
  pointOfSale: z.number().int().positive(),
  caiNumber: z.string().min(1, 'El número de CAI es obligatorio'),
  caiExpirationDate: z.string().min(1, 'La fecha de vencimiento es obligatoria'),
  startNumber: z.number().int().positive(),
  endNumber: z.number().int().positive(),
  lastUsedNumber: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
})

export async function GET() {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const configs = await prisma.caiConfig.findMany({
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(configs)
  } catch (error) {
    console.error('Error fetching CAI configs:', error)
    return NextResponse.json({ error: 'Error al obtener configuraciones de CAI' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const validated = caiConfigSchema.parse(body)

    if (validated.endNumber <= validated.startNumber) {
      return NextResponse.json(
        { error: 'El número final debe ser mayor al número inicial' },
        { status: 400 }
      )
    }

    // Desactivar configs activas anteriores del mismo PV
    if (validated.active !== false) {
      await prisma.caiConfig.updateMany({
        where: { pointOfSale: validated.pointOfSale, active: true },
        data: { active: false },
      })
    }

    const config = await prisma.caiConfig.create({
      data: {
        pointOfSale: validated.pointOfSale,
        caiNumber: validated.caiNumber,
        caiExpirationDate: new Date(validated.caiExpirationDate),
        startNumber: validated.startNumber,
        endNumber: validated.endNumber,
        lastUsedNumber: validated.lastUsedNumber ?? 0,
        active: validated.active ?? true,
      },
    })

    return NextResponse.json(config)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Datos inválidos', details: error.issues }, { status: 400 })
    }
    console.error('Error creating CAI config:', error)
    return NextResponse.json({ error: 'Error al crear configuración de CAI' }, { status: 500 })
  }
}

import { logger } from '@/lib/logger'
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// El mes se maneja siempre como string 'YYYY-MM' y las fechas como
// 'YYYY-MM-DD' en UTC, para que el @db.Date no corra un día por timezone.
function monthRange(mes: string) {
  const [year, month] = mes.split('-').map(Number)
  const desde = new Date(Date.UTC(year, month - 1, 1))
  const hasta = new Date(Date.UTC(year, month, 1))
  return { desde, hasta }
}

/**
 * GET /api/viandas?mes=YYYY-MM
 * Devuelve los días cargados del mes y el último precio conocido
 * (para prefijar el precio en meses nuevos).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const mes = new URL(request.url).searchParams.get('mes') || ''
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return NextResponse.json({ error: 'Parámetro mes inválido (YYYY-MM)' }, { status: 400 })
    }

    const { desde, hasta } = monthRange(mes)

    const [dias, ultimo] = await Promise.all([
      prisma.viandaDay.findMany({
        where: { fecha: { gte: desde, lt: hasta } },
        orderBy: { fecha: 'asc' },
      }),
      prisma.viandaDay.findFirst({ orderBy: { fecha: 'desc' } }),
    ])

    return NextResponse.json({
      dias: dias.map((d) => ({
        fecha: d.fecha.toISOString().slice(0, 10),
        cantidad: d.cantidad,
        precio: Number(d.precio),
      })),
      precioDefault: ultimo ? Number(ultimo.precio) : null,
    })
  } catch (error) {
    logger.error('[Viandas] Error en GET:', error)
    return NextResponse.json({ error: 'Error al cargar viandas' }, { status: 500 })
  }
}

const putSchema = z.object({
  mes: z.string().regex(/^\d{4}-\d{2}$/),
  precio: z.number().positive(),
  dias: z.array(
    z.object({
      fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      cantidad: z.number().int().min(0).nullable(),
    })
  ),
})

/**
 * PUT /api/viandas
 * Guarda la grilla completa de un mes: upsert de los días con cantidad
 * y borrado de los que quedaron vacíos. El precio se aplica a todos
 * los días del mes.
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const body = putSchema.parse(await request.json())

    for (const dia of body.dias) {
      if (!dia.fecha.startsWith(body.mes)) {
        return NextResponse.json(
          { error: `La fecha ${dia.fecha} no pertenece al mes ${body.mes}` },
          { status: 400 }
        )
      }
    }

    const conCantidad = body.dias.filter((d) => d.cantidad !== null)
    const vacios = body.dias.filter((d) => d.cantidad === null)

    await prisma.$transaction([
      ...conCantidad.map((d) =>
        prisma.viandaDay.upsert({
          where: { fecha: new Date(`${d.fecha}T00:00:00.000Z`) },
          create: {
            fecha: new Date(`${d.fecha}T00:00:00.000Z`),
            cantidad: d.cantidad!,
            precio: body.precio,
          },
          update: { cantidad: d.cantidad!, precio: body.precio },
        })
      ),
      prisma.viandaDay.deleteMany({
        where: { fecha: { in: vacios.map((d) => new Date(`${d.fecha}T00:00:00.000Z`)) } },
      }),
    ])

    return NextResponse.json({ ok: true, guardados: conCantidad.length })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Datos inválidos', detalles: error.issues }, { status: 400 })
    }
    logger.error('[Viandas] Error en PUT:', error)
    return NextResponse.json({ error: 'Error al guardar viandas' }, { status: 500 })
  }
}

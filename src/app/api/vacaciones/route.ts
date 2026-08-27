/**
 * API del módulo Vacaciones (control de ausencias de empleados).
 *
 * GET   ?mes=YYYY-MM  → empleados + ausencias del mes + resumen del año
 * POST  { empleadoId, fecha: 'YYYY-MM-DD', tipo: AusenciaTipo | null }
 *        → marca/cambia/borra la ausencia de ese día (null = borrar)
 * PATCH { empleadoId, saldoVacaciones: number | null } → saldo pendiente
 * PUT   { nombre } → alta de empleado
 *
 * Fechas siempre en UTC ('YYYY-MM-DD') para que el @db.Date no corra un día.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { z } from 'zod'

function monthRange(mes: string) {
  const [year, month] = mes.split('-').map(Number)
  return {
    desde: new Date(Date.UTC(year, month - 1, 1)),
    hasta: new Date(Date.UTC(year, month, 1)),
    anioDesde: new Date(Date.UTC(year, 0, 1)),
    anioHasta: new Date(Date.UTC(year + 1, 0, 1)),
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const mes = new URL(request.url).searchParams.get('mes') || ''
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return NextResponse.json({ error: 'Parámetro mes inválido (YYYY-MM)' }, { status: 400 })
    }
    const { desde, hasta, anioDesde, anioHasta } = monthRange(mes)

    const [empleados, ausenciasMes, ausenciasAnio] = await Promise.all([
      prisma.empleado.findMany({ orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] }),
      prisma.ausencia.findMany({ where: { fecha: { gte: desde, lt: hasta } } }),
      prisma.ausencia.groupBy({
        by: ['empleadoId', 'tipo'],
        where: { fecha: { gte: anioDesde, lt: anioHasta } },
        _count: { _all: true },
      }),
    ])

    return NextResponse.json({
      empleados: empleados.map((e) => ({
        id: e.id,
        nombre: e.nombre,
        activo: e.activo,
        saldoVacaciones: e.saldoVacaciones,
      })),
      ausencias: ausenciasMes.map((a) => ({
        empleadoId: a.empleadoId,
        fecha: a.fecha.toISOString().slice(0, 10),
        tipo: a.tipo,
      })),
      resumenAnio: ausenciasAnio.map((r) => ({
        empleadoId: r.empleadoId,
        tipo: r.tipo,
        dias: r._count._all,
      })),
    })
  } catch (error) {
    logger.error('[Vacaciones] Error en GET:', error)
    return NextResponse.json({ error: 'Error al cargar vacaciones' }, { status: 500 })
  }
}

const postSchema = z.object({
  empleadoId: z.string().min(1),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tipo: z.enum(['VACACIONES', 'PERSONAL', 'ENFERMEDAD']).nullable(),
})

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { empleadoId, fecha, tipo } = postSchema.parse(await request.json())
    const fechaUtc = new Date(`${fecha}T00:00:00.000Z`)

    if (tipo === null) {
      await prisma.ausencia.deleteMany({ where: { empleadoId, fecha: fechaUtc } })
    } else {
      await prisma.ausencia.upsert({
        where: { empleadoId_fecha: { empleadoId, fecha: fechaUtc } },
        create: { empleadoId, fecha: fechaUtc, tipo },
        update: { tipo },
      })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
    }
    logger.error('[Vacaciones] Error en POST:', error)
    return NextResponse.json({ error: 'Error al guardar' }, { status: 500 })
  }
}

const patchSchema = z.object({
  empleadoId: z.string().min(1),
  saldoVacaciones: z.number().int().min(0).max(365).nullable(),
})

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { empleadoId, saldoVacaciones } = patchSchema.parse(await request.json())
    await prisma.empleado.update({ where: { id: empleadoId }, data: { saldoVacaciones } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
    }
    logger.error('[Vacaciones] Error en PATCH:', error)
    return NextResponse.json({ error: 'Error al guardar saldo' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { nombre } = z.object({ nombre: z.string().trim().min(1).max(60) }).parse(await request.json())
    const max = await prisma.empleado.aggregate({ _max: { orden: true } })
    const empleado = await prisma.empleado.create({
      data: { nombre: nombre.toUpperCase(), orden: (max._max.orden ?? 0) + 1 },
    })
    return NextResponse.json({ empleado }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Nombre inválido' }, { status: 400 })
    }
    const msg = (error as { code?: string })?.code === 'P2002' ? 'Ya existe un empleado con ese nombre' : 'Error al crear empleado'
    logger.error('[Vacaciones] Error en PUT:', error)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

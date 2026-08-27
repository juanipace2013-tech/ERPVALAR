/**
 * API del módulo Vacaciones (control de ausencias de empleados).
 *
 * GET   ?mes=YYYY-MM → empleados (con saldo calculado por LCT), ausencias de
 *        TODO el año (para la vista anual), feriados y aviso del 30/4
 * POST  { empleadoId, tipo|null, fecha } o { empleadoId, tipo|null, desde, hasta }
 *        → marca/borra un día o un rango; devuelve solapamientos con otros
 * PATCH { empleadoId, saldoObjetivo } → ajusta el saldo calculado (corrección manual)
 * PUT   { nombre } → alta de empleado
 *
 * Solo editan Santiago y Juan (VACACIONES_EDITORES); el resto puede ver.
 * Fechas siempre en UTC ('YYYY-MM-DD') para que el @db.Date no corra un día.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import {
  puedeEditarVacaciones,
  diasVacacionesLct,
  computarSaldo,
  SALDO_ANIO_BASE,
} from '@/lib/vacaciones'
import { feriadosDelAnio } from '@/lib/feriados-ar'
import { z } from 'zod'

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const mes = new URL(request.url).searchParams.get('mes') || ''
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return NextResponse.json({ error: 'Parámetro mes inválido (YYYY-MM)' }, { status: 400 })
    }
    const anio = Number(mes.slice(0, 4))

    const [empleados, ausenciasAnio, vDesdeBase] = await Promise.all([
      prisma.empleado.findMany({ orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] }),
      // Todo el año visible (alimenta la grilla mensual Y la vista anual)
      prisma.ausencia.findMany({
        where: { fecha: { gte: new Date(Date.UTC(anio, 0, 1)), lt: new Date(Date.UTC(anio + 1, 0, 1)) } },
        orderBy: { fecha: 'asc' },
      }),
      // Todas las V desde el año base (las cargadas a futuro también descuentan)
      prisma.ausencia.findMany({
        where: {
          tipo: 'VACACIONES',
          fecha: { gte: new Date(Date.UTC(SALDO_ANIO_BASE, 0, 1)) },
        },
        select: { empleadoId: true, fecha: true },
      }),
    ])

    // V tomadas por empleado y año
    const vPorEmpAnio = new Map<string, Map<number, number>>()
    for (const a of vDesdeBase) {
      const y = a.fecha.getUTCFullYear()
      const m = vPorEmpAnio.get(a.empleadoId) ?? new Map<number, number>()
      m.set(y, (m.get(y) ?? 0) + 1)
      vPorEmpAnio.set(a.empleadoId, m)
    }

    // Aviso 30/4: saldo del año pasado que vence el 30/4 del año EN CURSO
    const hoy = new Date()
    const anioActual = hoy.getUTCFullYear()
    const antesDelVencimiento = hoy <= new Date(Date.UTC(anioActual, 3, 30, 23, 59, 59))

    return NextResponse.json({
      puedeEditar: puedeEditarVacaciones(session.user?.email),
      feriados: feriadosDelAnio(anio),
      empleados: empleados.map((e) => {
        const conSaldo = !e.esSocio && !!e.fechaIngreso
        const vMap = vPorEmpAnio.get(e.id) ?? new Map<number, number>()
        const saldoInfo = conSaldo
          ? computarSaldo({
              fechaIngreso: e.fechaIngreso!,
              ajusteSaldo: e.ajusteSaldo,
              hoy,
              vTomadasPorAnio: vMap,
            })
          : null
        // Días de años ANTERIORES sin tomar (vencen el 30/4 del año en curso):
        // ajuste + corresponden de años < actual − todas las V registradas
        let venceAbril: number | null = null
        if (conSaldo && antesDelVencimiento) {
          const desde = Math.max(SALDO_ANIO_BASE, e.fechaIngreso!.getUTCFullYear())
          let previo = e.ajusteSaldo
          for (let y = desde; y < anioActual; y++) previo += diasVacacionesLct(e.fechaIngreso!, y)
          for (const n of vMap.values()) previo -= n
          if (previo > 0) venceAbril = previo
        }
        return {
          id: e.id,
          nombre: e.nombre,
          activo: e.activo,
          esSocio: e.esSocio,
          fechaIngreso: e.fechaIngreso ? e.fechaIngreso.toISOString().slice(0, 10) : null,
          corresponden: conSaldo ? diasVacacionesLct(e.fechaIngreso!, anio) : null,
          saldo: saldoInfo?.saldo ?? null,
          saldoDetalle: saldoInfo?.detalle ?? null,
          proximaActivacion: saldoInfo?.proximaActivacion ?? null,
          ajusteSaldo: e.ajusteSaldo,
          venceAbril,
        }
      }),
      ausencias: ausenciasAnio.map((a) => ({
        empleadoId: a.empleadoId,
        fecha: a.fecha.toISOString().slice(0, 10),
        tipo: a.tipo,
      })),
    })
  } catch (error) {
    logger.error('[Vacaciones] Error en GET:', error)
    return NextResponse.json({ error: 'Error al cargar vacaciones' }, { status: 500 })
  }
}

const fechaRegex = /^\d{4}-\d{2}-\d{2}$/
const postSchema = z
  .object({
    empleadoId: z.string().min(1),
    tipo: z.enum(['VACACIONES', 'PERSONAL', 'ENFERMEDAD']).nullable(),
    fecha: z.string().regex(fechaRegex).optional(),
    desde: z.string().regex(fechaRegex).optional(),
    hasta: z.string().regex(fechaRegex).optional(),
  })
  .refine((d) => (d.fecha ? !d.desde && !d.hasta : !!d.desde && !!d.hasta), {
    message: 'Enviar fecha, o desde y hasta',
  })

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    if (!puedeEditarVacaciones(session.user?.email)) {
      return NextResponse.json({ error: 'Solo Santiago y Juan pueden editar la planilla' }, { status: 403 })
    }

    const body = postSchema.parse(await request.json())
    const desde = body.fecha ?? body.desde!
    const hasta = body.fecha ?? body.hasta!
    if (desde > hasta) {
      return NextResponse.json({ error: 'El rango es inválido (desde > hasta)' }, { status: 400 })
    }
    const dias: string[] = []
    for (let d = utc(desde); d <= utc(hasta); d.setUTCDate(d.getUTCDate() + 1)) {
      dias.push(d.toISOString().slice(0, 10))
    }
    if (dias.length > 62) {
      return NextResponse.json({ error: 'El rango no puede superar los 62 días' }, { status: 400 })
    }

    if (body.tipo === null) {
      await prisma.ausencia.deleteMany({
        where: { empleadoId: body.empleadoId, fecha: { gte: utc(desde), lte: utc(hasta) } },
      })
    } else {
      await prisma.$transaction([
        prisma.ausencia.deleteMany({
          where: { empleadoId: body.empleadoId, fecha: { gte: utc(desde), lte: utc(hasta) } },
        }),
        prisma.ausencia.createMany({
          data: dias.map((f) => ({ empleadoId: body.empleadoId, fecha: utc(f), tipo: body.tipo! })),
        }),
      ])
    }

    // Solapamientos: otros empleados ACTIVOS con vacaciones en el mismo rango
    const solap = body.tipo
      ? await prisma.ausencia.findMany({
          where: {
            tipo: 'VACACIONES',
            empleadoId: { not: body.empleadoId },
            fecha: { gte: utc(desde), lte: utc(hasta) },
            empleado: { activo: true },
          },
          include: { empleado: { select: { nombre: true } } },
          orderBy: { fecha: 'asc' },
        })
      : []
    const porEmpleado = new Map<string, { desde: string; hasta: string }>()
    for (const s of solap) {
      const f = s.fecha.toISOString().slice(0, 10)
      const cur = porEmpleado.get(s.empleado.nombre)
      if (!cur) porEmpleado.set(s.empleado.nombre, { desde: f, hasta: f })
      else cur.hasta = f
    }

    return NextResponse.json({
      ok: true,
      solapamientos: [...porEmpleado.entries()].map(([nombre, r]) => ({ nombre, ...r })),
    })
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
  /** Saldo real a hoy: el server recalcula el ajuste para que cierre */
  saldoObjetivo: z.number().int().min(-365).max(365),
})

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    if (!puedeEditarVacaciones(session.user?.email)) {
      return NextResponse.json({ error: 'Solo Santiago y Juan pueden editar la planilla' }, { status: 403 })
    }

    const { empleadoId, saldoObjetivo } = patchSchema.parse(await request.json())
    const emp = await prisma.empleado.findUnique({ where: { id: empleadoId } })
    if (!emp) return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })
    if (emp.esSocio || !emp.fechaIngreso) {
      return NextResponse.json({ error: 'Este empleado no lleva saldo (socio o sin fecha de ingreso)' }, { status: 400 })
    }

    const vTomadas = await prisma.ausencia.findMany({
      where: {
        empleadoId,
        tipo: 'VACACIONES',
        fecha: { gte: new Date(Date.UTC(SALDO_ANIO_BASE, 0, 1)) },
      },
      select: { fecha: true },
    })
    const vPorAnio = new Map<number, number>()
    for (const a of vTomadas) {
      const y = a.fecha.getUTCFullYear()
      vPorAnio.set(y, (vPorAnio.get(y) ?? 0) + 1)
    }
    const sinAjuste = computarSaldo({
      fechaIngreso: emp.fechaIngreso,
      ajusteSaldo: 0,
      hoy: new Date(),
      vTomadasPorAnio: vPorAnio,
    })
    const ajusteSaldo = saldoObjetivo - sinAjuste.saldo
    await prisma.empleado.update({ where: { id: empleadoId }, data: { ajusteSaldo } })
    return NextResponse.json({ ok: true, ajusteSaldo, saldo: saldoObjetivo })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
    }
    logger.error('[Vacaciones] Error en PATCH:', error)
    return NextResponse.json({ error: 'Error al ajustar el saldo' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    if (!puedeEditarVacaciones(session.user?.email)) {
      return NextResponse.json({ error: 'Solo Santiago y Juan pueden editar la planilla' }, { status: 403 })
    }

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

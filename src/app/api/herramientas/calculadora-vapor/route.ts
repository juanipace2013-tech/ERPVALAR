import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { calcularReguladoraVapor } from '@/lib/calculoReguladoraVapor'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')

    const calculos = await prisma.calculoReguladoraVapor.findMany({
      select: {
        id: true,
        p1: true,
        p2: true,
        q: true,
        cliente: true,
        referencia: true,
        regimen: true,
        cvCalculado: true,
        medida: true,
        porcentajeTrabajo: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    })

    return NextResponse.json(calculos)
  } catch (error) {
    logger.error('Error fetching historial calculadora vapor:', error)
    return NextResponse.json(
      { error: 'Error al obtener historial' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const p1 = Number(body.p1)
    const p2 = Number(body.p2)
    const q = Number(body.q)

    // El resumen del resultado se recalcula acá: no se confía en lo que
    // mande el cliente para los campos derivados.
    let resultado
    try {
      resultado = calcularReguladoraVapor(p1, p2, q)
    } catch {
      return NextResponse.json(
        { error: 'Parámetros inválidos: se requiere P1 > P2 > 0 y Q > 0.' },
        { status: 400 }
      )
    }

    const calculo = await prisma.calculoReguladoraVapor.create({
      data: {
        p1,
        p2,
        q,
        cliente: typeof body.cliente === 'string' && body.cliente.trim() ? body.cliente.trim() : null,
        referencia:
          typeof body.referencia === 'string' && body.referencia.trim()
            ? body.referencia.trim()
            : null,
        regimen: resultado.regimen,
        cvCalculado: resultado.cvCalculado,
        medida: resultado.seleccion?.medida ?? null,
        porcentajeTrabajo: resultado.seleccion?.porcentajeTrabajo ?? null,
        userId: session.user.id,
      },
      select: {
        id: true,
        p1: true,
        p2: true,
        q: true,
        cliente: true,
        referencia: true,
        regimen: true,
        cvCalculado: true,
        medida: true,
        porcentajeTrabajo: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json(calculo, { status: 201 })
  } catch (error) {
    logger.error('Error guardando calculo reguladora vapor:', error)
    return NextResponse.json(
      { error: 'Error al guardar el cálculo' },
      { status: 500 }
    )
  }
}

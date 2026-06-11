import { NextRequest, NextResponse } from 'next/server'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

// GET /api/exiros/licitaciones — listado para la UI, con filtros e ítems.
// Las licitaciones con `cierre` pasado se devuelven con estadoEfectivo VENCIDA
// (computado, no persistido) salvo que ya estén en un estado terminal.
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const veredicto = searchParams.get('veredicto') || ''
    const estado = searchParams.get('estado') || ''
    const empresa = searchParams.get('empresa') || ''
    const plataforma = searchParams.get('plataforma') || ''
    const search = searchParams.get('search') || ''
    const countOnly = searchParams.get('countOnly') === 'true'

    // Modo liviano para el badge del sidebar: solo el count de NUEVAs vigentes.
    if (countOnly) {
      const nuevasCount = await prisma.exirosLicitacion.count({
        where: {
          estado: 'NUEVA',
          OR: [{ cierre: null }, { cierre: { gte: new Date() } }],
        },
      })
      return NextResponse.json({ nuevasCount })
    }

    const where: Record<string, unknown> = {}
    if (veredicto) where.veredicto = veredicto
    if (empresa) where.empresa = empresa
    // "ARIBA" agrupa también el valor legacy ARIBA_PAMPA
    if (plataforma === 'ARIBA') where.plataforma = { startsWith: 'ARIBA' }
    else if (plataforma) where.plataforma = plataforma
    if (search) {
      where.OR = [
        { numero: { contains: search, mode: 'insensitive' } },
        { titulo: { contains: search, mode: 'insensitive' } },
      ]
    }

    // El filtro por estado se aplica después de computar VENCIDA, así
    // "estado=VENCIDA" funciona aunque en la DB siga diciendo NUEVA.

    const licitaciones = await prisma.exirosLicitacion.findMany({
      where,
      include: { items: { orderBy: { nro: 'asc' } } },
      orderBy: [{ cierre: 'asc' }, { createdAt: 'desc' }],
    })

    const now = Date.now()
    // Estados que conservan su valor aunque el cierre haya pasado: la gestión
    // ya terminó o está en manos del agente.
    const terminales = new Set(['COTIZADA', 'DECLINADA', 'DECLINE_ERROR', 'IGNORADA', 'DECLINAR_PENDIENTE'])

    let result = licitaciones.map((lic) => {
      const vencida = lic.cierre !== null && lic.cierre.getTime() < now && !terminales.has(lic.estado)
      return { ...lic, estadoEfectivo: vencida ? 'VENCIDA' : lic.estado }
    })

    if (estado) {
      result = result.filter((lic) => lic.estadoEfectivo === estado)
    }

    const nuevasCount = result.filter((lic) => lic.estadoEfectivo === 'NUEVA').length

    return NextResponse.json({ licitaciones: result, nuevasCount })
  } catch (e) {
    logger.error('[exiros/licitaciones] GET error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

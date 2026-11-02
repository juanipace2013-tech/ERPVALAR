import { logger } from '@/lib/logger'
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { buildCertificado, type CertificadosBody } from '@/lib/certificados-server'

export async function GET() {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const certificados = await prisma.certificadoCalibracion.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        fecha: true,
        cliente: true,
        oc: true,
        referencia: true,
        valvulas: true,
        titulo: true,
        subtitulo: true,
        emitidoPor: true,
        createdAt: true,
      },
    })
    return NextResponse.json({ certificados })
  } catch (error) {
    logger.error('Error listando certificados:', error)
    return NextResponse.json({ error: 'Error al listar certificados' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const body = (await request.json()) as CertificadosBody
    const built = await buildCertificado(body)
    if ('error' in built) {
      return NextResponse.json({ error: built.error }, { status: 400 })
    }

    await prisma.certificadoCalibracion.create({
      data: {
        ...built.record,
        emitidoPor: session.user?.name || session.user?.email || null,
      },
    })

    return new NextResponse(new Uint8Array(built.pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${built.filename}"`,
      },
    })
  } catch (error) {
    logger.error('Error generando certificados:', error)
    return NextResponse.json(
      {
        error: 'Error al generar certificados',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

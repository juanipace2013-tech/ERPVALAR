import { logger } from '@/lib/logger'
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { buildCertificado, type CertificadosBody } from '@/lib/certificados-server'

/** Certificado completo (con payload) para cargarlo en el formulario y editarlo. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const cert = await prisma.certificadoCalibracion.findUnique({
      where: { id },
    })
    if (!cert) {
      return NextResponse.json({ error: 'Certificado no encontrado' }, { status: 404 })
    }
    return NextResponse.json(cert)
  } catch (error) {
    logger.error('Error leyendo certificado:', error)
    return NextResponse.json({ error: 'Error al leer el certificado' }, { status: 500 })
  }
}

/**
 * Edita un certificado ya emitido: reemplaza sus datos (mismo registro, no
 * crea uno nuevo) y devuelve el PDF regenerado.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const existing = await prisma.certificadoCalibracion.findUnique({
      where: { id },
      select: { id: true, cliente: true, valvulas: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Certificado no encontrado' }, { status: 404 })
    }

    const body = (await request.json()) as CertificadosBody
    const built = await buildCertificado(body)
    if ('error' in built) {
      return NextResponse.json({ error: built.error }, { status: 400 })
    }

    await prisma.certificadoCalibracion.update({
      where: { id },
      data: built.record,
    })

    logAudit({
      userId: session.user?.id || '',
      userName: session.user?.name || '',
      userEmail: session.user?.email || '',
      action: 'UPDATE',
      entity: 'CERTIFICADO',
      entityId: id,
      entityRef: built.record.cliente,
      description: `Editó certificado de calibración de ${existing.cliente} (válvulas ${existing.valvulas.join(', ')})`,
    })

    return new NextResponse(new Uint8Array(built.pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${built.filename}"`,
      },
    })
  } catch (error) {
    logger.error('Error editando certificado:', error)
    return NextResponse.json(
      {
        error: 'Error al editar el certificado',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

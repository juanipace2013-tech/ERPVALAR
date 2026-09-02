import { logger } from '@/lib/logger'
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import {
  generateCertificadoCalibracionPDF,
  type CertificadoCalibracionData,
} from '@/lib/pdf/certificado-calibracion-generator'
import { getLogoBlanco } from '@/lib/logo-blanco-base64'

/** Re-descarga un certificado emitido, regenerando el PDF desde el payload guardado. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const cert = await prisma.certificadoCalibracion.findUnique({ where: { id } })
    if (!cert) {
      return NextResponse.json({ error: 'Certificado no encontrado' }, { status: 404 })
    }

    const payload = cert.payload as unknown as Omit<CertificadoCalibracionData, 'fecha' | 'logoBase64'> & {
      fecha: string
    }
    const data: CertificadoCalibracionData = {
      ...payload,
      fecha: new Date(payload.fecha),
      logoBase64: await getLogoBlanco(),
    }

    const doc = generateCertificadoCalibracionPDF(data)
    const buffer = Buffer.from(doc.output('arraybuffer'))

    const safeName = cert.cliente.replace(/[/\\:*?"<>|]/g, '-').trim()
    const nums = cert.valvulas
    const rangeLabel = nums.length > 1 ? `${nums[0]}-${nums[nums.length - 1]}` : nums[0]

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Certificados ${rangeLabel} ${safeName}.pdf"`,
      },
    })
  } catch (error) {
    logger.error('Error regenerando certificado:', error)
    return NextResponse.json({ error: 'Error al regenerar el certificado' }, { status: 500 })
  }
}

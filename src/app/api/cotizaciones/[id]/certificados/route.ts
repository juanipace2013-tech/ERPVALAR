import { logger } from '@/lib/logger'
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import {
  generateCertificadoCalibracionPDF,
  type CertificadoCalibracionData,
} from '@/lib/pdf/certificado-calibracion-generator'
import { getLogoBlanco } from '@/lib/logo-blanco-base64'

interface CertificadosBody {
  valvulas: string[]
  tituloPill: string
  titulo: string
  subtitulo: string
  specline: string
  descripcion: string
  marcaTipo: string
  materiales: Array<[string, string]>
  calibracion: Array<[string, string]>
  conexiones: Array<[string, string]>
  encargado: { nombre: string; rol: string }
}

function isPairArray(value: unknown): value is Array<[string, string]> {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        Array.isArray(row) && row.length === 2 && row.every((cell) => typeof cell === 'string')
    )
  )
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const body = (await request.json()) as CertificadosBody

    if (
      !Array.isArray(body.valvulas) ||
      body.valvulas.length === 0 ||
      body.valvulas.some((v) => typeof v !== 'string' || !v.trim())
    ) {
      return NextResponse.json({ error: 'Indicá al menos un número de válvula' }, { status: 400 })
    }
    if (
      !isPairArray(body.materiales) ||
      !isPairArray(body.calibracion) ||
      !isPairArray(body.conexiones)
    ) {
      return NextResponse.json({ error: 'Datos del certificado inválidos' }, { status: 400 })
    }

    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        customer: { select: { name: true, businessName: true } },
      },
    })
    if (!quote) {
      return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })
    }

    const cliente = quote.customer.businessName || quote.customer.name
    const data: CertificadoCalibracionData = {
      cliente,
      referencia: `Cot. ${quote.quoteNumber}`,
      fecha: new Date(),
      valvulas: body.valvulas.map((v) => v.trim()),
      tituloPill: body.tituloPill || 'CERTIFICADO DE CALIBRACIÓN',
      titulo: body.titulo || 'VÁLVULA DE SEGURIDAD',
      subtitulo: body.subtitulo || '',
      specline: body.specline || '',
      descripcion: body.descripcion || '',
      marcaTipo: body.marcaTipo || 'VALAR · Seguridad',
      materiales: body.materiales,
      calibracion: body.calibracion,
      conexiones: body.conexiones,
      encargado: {
        nombre: body.encargado?.nombre || 'ING Gabriel Krawczynski',
        rol: body.encargado?.rol || 'Encargado',
      },
      logoBase64: await getLogoBlanco(),
    }

    const doc = generateCertificadoCalibracionPDF(data)
    const buffer = Buffer.from(doc.output('arraybuffer'))

    const safeName = cliente.replace(/[/\\:*?"<>|]/g, '-').trim()
    const nums = data.valvulas
    const rangeLabel = nums.length > 1 ? `${nums[0]}-${nums[nums.length - 1]}` : nums[0]

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Certificados ${rangeLabel} ${safeName}.pdf"`,
      },
    })
  } catch (error) {
    logger.error('Error generando certificados:', error)
    return NextResponse.json(
      { error: 'Error al generar certificados', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

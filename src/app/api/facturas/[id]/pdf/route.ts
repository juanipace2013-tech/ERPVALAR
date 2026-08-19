/**
 * GET /api/facturas/[id]/pdf — PDF de una factura emitida por el ERP (ARCA),
 * con CAE y QR. ?download=1 fuerza descarga.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { buildFacturaPdfData } from '@/lib/facturacion/factura-pdf-data'
import { generateFacturaPDF, facturaPdfFilename } from '@/lib/pdf/factura-generator'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { id } = await params
    const data = await buildFacturaPdfData(id)
    if (!data) {
      return NextResponse.json({ error: 'Factura no encontrada o no emitida por el ERP' }, { status: 404 })
    }

    const pdf = await generateFacturaPDF(data)
    const filename = facturaPdfFilename(data)
    const download = request.nextUrl.searchParams.get('download') === '1'
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    logger.error('[Factura PDF] Error:', error)
    return NextResponse.json({ error: 'Error al generar el PDF' }, { status: 500 })
  }
}

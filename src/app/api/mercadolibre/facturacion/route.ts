/**
 * GET  /api/mercadolibre/facturacion — ventas ML (desde el corte del PV 7) de
 *      compradores Responsables Inscriptos, con su estado de facturación.
 * POST /api/mercadolibre/facturacion { packId, cuit? } — emite la factura A
 *      (ARCA PV 7 → Colppy) y sube el PDF a la venta de ML.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { logAudit } from '@/lib/audit'
import { PadronError } from '@/lib/arca/padron'
import { FacturacionMlError, facturarVentaMl, listarVentasMl } from '@/lib/mercadolibre/facturacion'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    return NextResponse.json(await listarVentasMl())
  } catch (e) {
    logger.error('[ML Facturación] Error listando ventas', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { packId?: string; cuit?: string }
  const packId = String(body.packId ?? '').trim()
  if (!/^\d+$/.test(packId)) return NextResponse.json({ error: 'packId inválido' }, { status: 400 })

  try {
    const r = await facturarVentaMl({ packId, cuitManual: body.cuit, user: { id: session.user.id } })
    logAudit({
      userId: session.user.id,
      userName: session.user.name || '',
      userEmail: session.user.email || '',
      action: 'CREATE',
      entity: 'INVOICE',
      entityId: r.invoiceId,
      entityRef: r.invoiceNumber,
      description: `Facturó venta de Mercado Libre #${packId}: ${r.invoiceNumber} CAE ${r.cae}`,
    })
    return NextResponse.json({ success: true, ...r, pdfUrl: `/api/facturas/${r.invoiceId}/pdf` })
  } catch (e) {
    if (e instanceof FacturacionMlError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof PadronError) return NextResponse.json({ error: `ARCA (padrón): ${e.message}` }, { status: e.status })
    logger.error(`[ML Facturación] Error facturando ${packId}`, e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

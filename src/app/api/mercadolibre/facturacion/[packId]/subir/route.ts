/**
 * POST /api/mercadolibre/facturacion/[packId]/subir — reintenta subir a ML el
 * PDF de una venta ya facturada desde el ERP.
 */
import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import { subirFacturaAMl } from '@/lib/mercadolibre/facturacion'

export async function POST(_req: Request, { params }: { params: Promise<{ packId: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { packId } = await params
  const r = await subirFacturaAMl(packId)
  return NextResponse.json(r, { status: r.ok ? 200 : 502 })
}

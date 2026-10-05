/**
 * GET /api/mercadolibre/facturacion/[packId]/comprador[?cuit=NN-NNNNNNNN-N]
 * Datos del comprador para el borrador: CUIT/CUIL (de ML, derivado del DNI
 * con el padrón de ARCA, o el ingresado en ?cuit=), condición en ARCA y la
 * factura que corresponde (letra + documento del receptor). No emite nada.
 * Si la venta ya tiene el candado del ERP (facturada o en emisión) devuelve
 * `yaFacturada` con el motivo, sin consultar ML ni ARCA (= 409 YA_FACTURADA
 * del POST): el borrador no ofrece emitir ni "Emitir igual".
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { MlApiError } from '@/lib/mercadolibre/client'
import { FacturacionMlError, resolverCompradorMl } from '@/lib/mercadolibre/facturacion'

export async function GET(req: NextRequest, { params }: { params: Promise<{ packId: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { packId } = await params
  if (!/^\d+$/.test(packId)) return NextResponse.json({ error: 'packId inválido' }, { status: 400 })

  try {
    return NextResponse.json(await resolverCompradorMl(packId, req.nextUrl.searchParams.get('cuit')))
  } catch (e) {
    if (e instanceof FacturacionMlError) {
      return NextResponse.json({ error: e.message, ...(e.codigo ? { codigo: e.codigo } : {}) }, { status: e.status })
    }
    if (e instanceof MlApiError && e.status === 404) {
      return NextResponse.json({ error: 'La venta no existe en Mercado Libre' }, { status: 404 })
    }
    logger.error(`[ML Facturación] Error resolviendo el comprador de ${packId}`, e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

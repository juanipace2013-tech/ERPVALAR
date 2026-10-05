/**
 * GET /api/facturas/directa/venta-ml/[id] — datos de una venta de Mercado
 * Libre (pack u orden) para vincularla a una factura directa. Solo
 * informativa: no toma el candado ni emite (al emitir se verifica todo de
 * nuevo). Un order id que pertenece a un pack devuelve la clave del pack.
 *
 * 200 { packId, orderIds, fecha, buyerNickname, totalMl, pagada, noPagas,
 *       fiscal, fiscalError, documentoMl, nombreMl, domicilioMl,
 *       lineas: [{ productId, sku, descripcion, cantidad, precioUnitario (final) }],
 *       facturaEnMl, yaFacturada, anteriorAlCorte }
 * 400 id inválido · 401/403 · 404 la venta no existe en ML.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole, ROLES } from '@/lib/authz'
import { logger } from '@/lib/logger'
import { MlApiError } from '@/lib/mercadolibre/client'
import { VentaMlError, inspeccionarVentaMl } from '@/lib/mercadolibre/venta-ml-vinculo'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const forbidden = requireRole(session, ROLES.FINANZAS, 'Sin permisos para emitir facturas directas')
  if (forbidden) return forbidden

  const { id } = await params
  if (!/^\d{1,20}$/.test(id)) return NextResponse.json({ error: 'Número de venta inválido', codigo: 'PEDIDO_INVALIDO' }, { status: 400 })

  try {
    return NextResponse.json(await inspeccionarVentaMl(id))
  } catch (e) {
    if (e instanceof VentaMlError) return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: e.status })
    if (e instanceof MlApiError && e.status === 404) {
      return NextResponse.json({ error: 'La venta no existe en Mercado Libre', codigo: 'ML_VENTA_NO_EXISTE' }, { status: 404 })
    }
    logger.error(`[Factura directa] Error consultando la venta de ML ${id}`, e)
    return NextResponse.json({ error: (e as Error).message, codigo: 'ML_NO_DISPONIBLE' }, { status: 502 })
  }
}

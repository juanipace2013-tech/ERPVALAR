import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getFamiqLiveData } from '@/lib/famiq/client'
import { logger } from '@/lib/logger'

/**
 * GET /api/famiq/stock?sku=322741
 * Stock en vivo por sucursal y precio de lista general (USD) desde la web de
 * FAMIQ, para productos con mapeo en FamiqLink. Además guarda el último precio
 * de lista visto, para detectar cambios de lista contra el costo cargado.
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const sku = request.nextUrl.searchParams.get('sku')?.trim()
  if (!sku) return NextResponse.json({ error: 'Falta sku' }, { status: 400 })

  const link = await prisma.famiqLink.findUnique({ where: { codigo: sku } })
  if (!link) return NextResponse.json({ linked: false })

  const data = await getFamiqLiveData(link.webId)
  if (!data) return NextResponse.json({ linked: true, error: 'FAMIQ no respondió' }, { status: 502 })

  // Snapshot del precio de lista (para ver aumentos de lista sin la planilla)
  const prev = link.precioListaWeb == null ? null : Number(link.precioListaWeb)
  if (data.precioListaUsd != null && data.precioListaUsd !== prev) {
    prisma.famiqLink
      .update({ where: { id: link.id }, data: { precioListaWeb: data.precioListaUsd, precioListaWebAt: new Date() } })
      .catch((e) => logger.error('[FAMIQ] snapshot precio falló', e))
  }

  return NextResponse.json({
    linked: true,
    codigo: data.codigo,
    stockTotal: data.stockTotal,
    sucursales: data.sucursales.filter((s) => s.stock > 0),
    precioListaUsd: data.precioListaUsd,
    precioListaAnterior: prev != null && prev !== data.precioListaUsd ? prev : null,
    fetchedAt: data.fetchedAt,
    url: `https://www.famiq.com.ar/producto/${link.webId}-x`,
  })
}

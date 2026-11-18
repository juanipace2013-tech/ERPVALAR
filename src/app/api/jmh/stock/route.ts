import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getJmhLiveData, JMH_BASE } from '@/lib/jmh/client'
import { logger } from '@/lib/logger'

/**
 * GET /api/jmh/stock?sku=MN90114RF0010D
 * Stock en vivo y precio de lista general (USD) desde la tienda de JMH, para
 * productos con mapeo en JmhLink. Además guarda el último precio de lista
 * visto, para detectar cambios de lista contra el costo cargado.
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const sku = request.nextUrl.searchParams.get('sku')?.trim().toUpperCase()
  if (!sku) return NextResponse.json({ error: 'Falta sku' }, { status: 400 })

  const link = await prisma.jmhLink.findUnique({ where: { codigo: sku } })
  if (!link) return NextResponse.json({ linked: false })

  const url = `${JMH_BASE}/shop/${link.templateId}`
  const data = await getJmhLiveData(link.templateId)
  if (!data) return NextResponse.json({ linked: true, url, error: 'JMH no respondió' }, { status: 502 })

  // Snapshot del precio de lista (para ver aumentos de lista sin la planilla)
  const prev = link.precioListaWeb == null ? null : Number(link.precioListaWeb)
  if (data.precioListaUsd != null && data.precioListaUsd !== prev) {
    prisma.jmhLink
      .update({ where: { id: link.id }, data: { precioListaWeb: data.precioListaUsd, precioListaWebAt: new Date() } })
      .catch((e) => logger.error('[JMH] snapshot precio falló', e))
  }

  return NextResponse.json({
    linked: true,
    stock: data.stock,
    aPedido: data.aPedido,
    precioListaUsd: data.precioListaUsd,
    precioListaAnterior: prev != null && prev !== data.precioListaUsd ? prev : null,
    fetchedAt: data.fetchedAt,
    url,
  })
}

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { normalizeSkuForMatch } from '@/lib/purchase-invoices/sku-variants'

/**
 * GET /api/winters/stock?sku=120B0404
 * Stock local de WINTERS (Buenos Aires) según la última planilla "Stock WINAR"
 * importada por el cron ingest-stock-winters. La planilla trae solo los
 * códigos disponibles, así que "no está" = sin stock local (cantidad 0).
 * Devuelve { imported: false } si todavía no se importó ninguna planilla.
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const sku = request.nextUrl.searchParams.get('sku')?.trim()
  if (!sku) return NextResponse.json({ error: 'Falta sku' }, { status: 400 })

  let row = await prisma.wintersStock.findUnique({ where: { codigo: sku } })

  // Fallback sin separadores (mismo criterio que el vinculado de facturas):
  // solo si hay un único candidato.
  if (!row) {
    const norm = normalizeSkuForMatch(sku)
    if (norm) {
      const candidates = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM winters_stock
        WHERE regexp_replace(lower(codigo), '[^a-z0-9]', '', 'g') = ${norm}
        LIMIT 2`
      if (candidates.length === 1) {
        row = await prisma.wintersStock.findUnique({ where: { id: candidates[0].id } })
      }
    }
  }

  if (row) {
    return NextResponse.json({
      imported: true,
      cantidad: row.cantidad,
      descripcion: row.descripcion,
      fechaLista: row.fechaLista.toISOString(),
    })
  }

  const lastImport = await prisma.wintersStockImport.findFirst({
    where: { status: 'OK' },
    orderBy: { receivedAt: 'desc' },
    select: { fechaLista: true },
  })
  if (!lastImport) return NextResponse.json({ imported: false })

  return NextResponse.json({ imported: true, cantidad: 0, fechaLista: lastImport.fechaLista.toISOString() })
}

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import ExcelJS from 'exceljs'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const type = searchParams.get('type') || ''
    const belowMin = searchParams.get('belowMin') === 'true'

    const where: Record<string, unknown> = {}

    if (search) {
      where.OR = [
        { sku: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (type && type !== 'ALL') {
      where.type = type
    }

    if (belowMin) {
      where.minStock = { gt: 0 }
    }

    let products = await prisma.product.findMany({
      where,
      orderBy: { sku: 'asc' },
      select: {
        sku: true,
        name: true,
        stockQuantity: true,
        minStock: true,
        lastCost: true,
        averageCost: true,
        prices: {
          select: { amount: true, priceType: true },
        },
      },
    })

    if (belowMin) {
      products = products.filter(p => p.stockQuantity < p.minStock)
    }

    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('Inventario')

    const today = new Date().toLocaleDateString('es-AR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
    ws.mergeCells('A1:H1')
    const titleCell = ws.getCell('A1')
    titleCell.value = `Listado de Inventario - ${today}`
    titleCell.font = { bold: true, size: 14 }
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getRow(1).height = 28

    ws.mergeCells('A2:H2')
    const subtitleCell = ws.getCell('A2')
    const filters: string[] = []
    if (search) filters.push(`Búsqueda: "${search}"`)
    if (type && type !== 'ALL') filters.push(`Tipo: ${type}`)
    if (belowMin) filters.push('Solo bajo mínimo')
    subtitleCell.value = filters.length > 0
      ? `Filtros: ${filters.join(' | ')} — ${products.length} items`
      : `${products.length} items`
    subtitleCell.font = { size: 10, italic: true, color: { argb: 'FF666666' } }
    subtitleCell.alignment = { horizontal: 'center' }

    ws.columns = [
      { key: 'sku', width: 16 },
      { key: 'name', width: 50 },
      { key: 'salePrice', width: 14 },
      { key: 'lastCost', width: 14 },
      { key: 'averageCost', width: 14 },
      { key: 'minStock', width: 10 },
      { key: 'stockQuantity', width: 12 },
      { key: 'stockValue', width: 16 },
    ]

    const headerRow = ws.addRow({
      sku: 'Código',
      name: 'Descripción',
      salePrice: 'P. Venta',
      lastCost: 'Últ. Costo',
      averageCost: 'Cto. Prom.',
      minStock: 'Mín.',
      stockQuantity: 'Disponible',
      stockValue: 'Valor Stock',
    })
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FF1D4ED8' } },
      }
    })
    headerRow.height = 22

    for (const p of products) {
      const salePrice = p.prices?.find(pr => pr.priceType === 'SALE')
      const avgCost = Number(p.averageCost || 0)
      const stockValue = p.stockQuantity * avgCost

      const row = ws.addRow({
        sku: p.sku,
        name: p.name,
        salePrice: salePrice ? Number(salePrice.amount) : null,
        lastCost: p.lastCost ? Number(p.lastCost) : null,
        averageCost: avgCost || null,
        minStock: p.minStock || null,
        stockQuantity: p.stockQuantity,
        stockValue: stockValue > 0 ? stockValue : null,
      })

      // Formato moneda para columnas numéricas
      const currencyFormat = '#,##0.00'
      row.getCell('salePrice').numFmt = currencyFormat
      row.getCell('lastCost').numFmt = currencyFormat
      row.getCell('averageCost').numFmt = currencyFormat
      row.getCell('stockValue').numFmt = currencyFormat
      row.getCell('minStock').alignment = { horizontal: 'center' }
      row.getCell('stockQuantity').alignment = { horizontal: 'center' }

      // Resaltar items bajo mínimo
      if (p.minStock > 0 && p.stockQuantity < p.minStock) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
        })
        row.getCell('stockQuantity').font = { bold: true, color: { argb: 'FFDC2626' } }
      }
    }

    ws.autoFilter = { from: 'A3', to: 'H3' }
    ws.views = [{ state: 'frozen', ySplit: 3 }]

    const buffer = await workbook.xlsx.writeBuffer()
    const dateStr = new Date().toISOString().slice(0, 10)

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Inventario_${dateStr}.xlsx"`,
      },
    })
  } catch (error: unknown) {
    logger.error('Error exporting inventory items:', error)
    const message = error instanceof Error ? error.message : 'Error al exportar inventario'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

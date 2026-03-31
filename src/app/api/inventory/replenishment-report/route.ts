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
    const onlyBelowMin = searchParams.get('onlyBelowMin') !== 'false' // default true
    const brand = searchParams.get('brand') || ''
    const format = searchParams.get('format') // 'excel' para exportar

    const products = await prisma.product.findMany({
      where: {
        minStock: { gt: 0 },
        status: 'ACTIVE',
        ...(brand ? { brand: { contains: brand, mode: 'insensitive' as const } } : {}),
      },
      select: {
        id: true,
        sku: true,
        name: true,
        brand: true,
        minStock: true,
        stockQuantity: true,
        supplier: { select: { name: true } },
      },
      orderBy: { sku: 'asc' },
    })

    let report = products.map(p => {
      const currentStock = p.stockQuantity
      const difference = p.minStock - currentStock
      return {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        brand: p.brand || '',
        minStock: p.minStock,
        currentStock,
        difference, // positivo = hay que comprar
        supplierName: p.supplier?.name || '',
      }
    })

    if (onlyBelowMin) {
      report = report.filter(r => r.difference > 0)
    }

    report.sort((a, b) => b.difference - a.difference)

    // Exportar a Excel
    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook()
      const ws = workbook.addWorksheet('Reposición')

      // Encabezado del reporte
      const today = new Date().toLocaleDateString('es-AR', {
        year: 'numeric', month: '2-digit', day: '2-digit',
      })
      ws.mergeCells('A1:G1')
      const titleCell = ws.getCell('A1')
      titleCell.value = `Reporte de Reposición de Stock - ${today}`
      titleCell.font = { bold: true, size: 14 }
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
      ws.getRow(1).height = 28

      ws.mergeCells('A2:G2')
      const subtitleCell = ws.getCell('A2')
      subtitleCell.value = onlyBelowMin
        ? `Items bajo stock mínimo (${report.length} productos)`
        : `Todos los items con stock mínimo configurado (${report.length} productos)`
      subtitleCell.font = { size: 10, italic: true, color: { argb: 'FF666666' } }
      subtitleCell.alignment = { horizontal: 'center' }

      // Columnas
      ws.columns = [
        { key: 'sku', width: 16 },
        { key: 'name', width: 50 },
        { key: 'brand', width: 16 },
        { key: 'minStock', width: 14 },
        { key: 'currentStock', width: 14 },
        { key: 'difference', width: 14 },
        { key: 'supplierName', width: 25 },
      ]

      // Header row
      const headerRow = ws.addRow({
        sku: 'Código',
        name: 'Descripción',
        brand: 'Marca',
        minStock: 'Stock Mín',
        currentStock: 'Stock Actual',
        difference: 'A Comprar',
        supplierName: 'Proveedor',
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

      // Data rows
      for (const item of report) {
        const row = ws.addRow({
          sku: item.sku,
          name: item.name,
          brand: item.brand,
          minStock: item.minStock,
          currentStock: item.currentStock,
          difference: item.difference > 0 ? item.difference : 0,
          supplierName: item.supplierName,
        })

        // Resaltar filas bajo mínimo
        if (item.difference > 0) {
          row.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
          })
          // Columna "A Comprar" en rojo bold
          const diffCell = row.getCell('difference')
          diffCell.font = { bold: true, color: { argb: 'FFDC2626' } }
        }

        // Alinear números al centro
        row.getCell('minStock').alignment = { horizontal: 'center' }
        row.getCell('currentStock').alignment = { horizontal: 'center' }
        row.getCell('difference').alignment = { horizontal: 'center' }
      }

      // Autofilter
      ws.autoFilter = { from: 'A3', to: 'G3' }

      // Freeze header
      ws.views = [{ state: 'frozen', ySplit: 3 }]

      const buffer = await workbook.xlsx.writeBuffer()
      const dateStr = new Date().toISOString().slice(0, 10)

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="Reporte_Reposicion_${dateStr}.xlsx"`,
        },
      })
    }

    // Respuesta JSON (para la tabla)
    // Obtener marcas distintas para el filtro
    const brands = [...new Set(products.map(p => p.brand).filter(Boolean))].sort()

    return NextResponse.json({
      report,
      brands,
      summary: {
        totalWithMinStock: products.length,
        belowMinimum: products.filter(p => p.stockQuantity < p.minStock).length,
        totalToOrder: report.reduce((sum, r) => sum + Math.max(0, r.difference), 0),
      },
    })
  } catch (error: unknown) {
    logger.error('Error in replenishment report:', error)
    const message = error instanceof Error ? error.message : 'Error en reporte de reposición'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

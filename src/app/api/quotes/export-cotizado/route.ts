/**
 * GET /api/quotes/export-cotizado
 * Genera un Excel con análisis de todo lo cotizado a nivel ítem (4 hojas):
 *   1. Detalle Ítems      – una fila por ítem cotizado
 *   2. Resumen por Producto – qué se cotiza más, en cantidad y montos
 *   3. Resumen por Marca
 *   4. Resumen por Cliente
 *
 * Query params:
 *   desde    – fecha inicio (YYYY-MM-DD)
 *   hasta    – fecha fin   (YYYY-MM-DD)
 *   vendedor – salesPersonId (omitir o vacío = todos)
 *   estado   – QuoteStatus específico (omitir = todos menos anuladas)
 *
 * Las cotizaciones anuladas (CANCELLED) se excluyen siempre.
 * Los ítems alternativos (10A, 10B...) aparecen en el detalle marcados como
 * "Sí" pero se excluyen de los resúmenes para no duplicar cantidades/montos.
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getLocalDateString } from '@/lib/utils'
import ExcelJS from 'exceljs'
import { logger } from '@/lib/logger'
import { QuoteStatus } from '@prisma/client'

const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E3A5F' },
}

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 11,
}

const HEADER_ALIGNMENT: Partial<ExcelJS.Alignment> = {
  vertical: 'middle',
  horizontal: 'center',
  wrapText: true,
}

const statusLabels: Record<string, string> = {
  DRAFT: 'Borrador',
  SENT: 'Enviada',
  ACCEPTED: 'Aceptada',
  REJECTED: 'Rechazada',
  EXPIRED: 'Vencida',
  CANCELLED: 'Anulada',
  CONVERTED: 'Facturada',
}

/** Aplica estilo de encabezado a la primera fila de una hoja */
function styleHeaderRow(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1)
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = HEADER_ALIGNMENT
  })
  row.height = 28
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const desde = searchParams.get('desde')
    const hasta = searchParams.get('hasta')
    const vendedorId = searchParams.get('vendedor')
    const estadoParam = searchParams.get('estado')
    const estado =
      estadoParam && estadoParam in QuoteStatus ? (estadoParam as QuoteStatus) : null

    // ---------- Filtros ----------
    const dateFilter: Record<string, Date> = {}
    if (desde) dateFilter.gte = new Date(desde)
    if (hasta) {
      const end = new Date(hasta)
      end.setHours(23, 59, 59, 999)
      dateFilter.lte = end
    }

    const quoteWhere = {
      ...(estado ? { status: estado } : { status: { not: QuoteStatus.CANCELLED } }),
      ...(vendedorId ? { salesPersonId: vendedorId } : {}),
      ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
    }

    const items = await prisma.quoteItem.findMany({
      where: { quote: quoteWhere },
      include: {
        quote: {
          select: {
            quoteNumber: true,
            date: true,
            status: true,
            customer: { select: { name: true } },
            salesPerson: { select: { name: true } },
          },
        },
        product: { select: { sku: true, name: true, brand: true } },
      },
      orderBy: [{ quote: { date: 'desc' } }, { itemNumber: 'asc' }],
    })

    // ======================== GENERAR EXCEL ========================
    const workbook = new ExcelJS.Workbook()

    // -------- HOJA 1: Detalle Ítems --------
    const ws1 = workbook.addWorksheet('Detalle Ítems')
    ws1.columns = [
      { header: 'Nº Cotización', key: 'quoteNumber', width: 18 },
      { header: 'Fecha', key: 'date', width: 12 },
      { header: 'Cliente', key: 'customer', width: 30 },
      { header: 'Vendedor', key: 'salesPerson', width: 20 },
      { header: 'Estado', key: 'status', width: 12 },
      { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Producto', key: 'producto', width: 45 },
      { header: 'Marca', key: 'marca', width: 16 },
      { header: 'Cantidad', key: 'cantidad', width: 10 },
      { header: 'Precio Unit. USD', key: 'unitPrice', width: 16 },
      { header: 'Total USD', key: 'totalUSD', width: 14 },
      { header: 'Alternativa', key: 'alternativa', width: 12 },
    ]

    for (const it of items) {
      ws1.addRow({
        quoteNumber: it.quote.quoteNumber,
        date: it.quote.date.toLocaleDateString('es-AR'),
        customer: it.quote.customer.name,
        salesPerson: it.quote.salesPerson.name,
        status: statusLabels[it.quote.status] || it.quote.status,
        sku: it.product?.sku || it.manualSku || '',
        producto: it.description || it.product?.name || '',
        marca: it.product?.brand || it.manualBrand || '',
        cantidad: it.quantity,
        unitPrice: Number(it.unitPrice),
        totalUSD: Number(it.totalPrice),
        alternativa: it.isAlternative ? 'Sí' : 'No',
      })
    }

    styleHeaderRow(ws1)
    if (items.length > 0) {
      ws1.autoFilter = { from: 'A1', to: `L${items.length + 1}` }
    }
    ws1.getColumn('unitPrice').numFmt = '#,##0.00'
    ws1.getColumn('totalUSD').numFmt = '#,##0.00'

    // Los resúmenes excluyen alternativas para no duplicar
    const mainItems = items.filter((it) => !it.isAlternative)
    const grandTotalUSD = mainItems.reduce((sum, it) => sum + Number(it.totalPrice), 0)

    // -------- HOJA 2: Resumen por Producto --------
    const ws2 = workbook.addWorksheet('Resumen por Producto')
    ws2.columns = [
      { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Producto', key: 'producto', width: 45 },
      { header: 'Marca', key: 'marca', width: 16 },
      { header: 'Veces Cotizado', key: 'veces', width: 15 },
      { header: 'Cantidad Total', key: 'cantidad', width: 15 },
      { header: 'Monto Total USD', key: 'montoUSD', width: 17 },
      { header: '% del Monto', key: 'porcentaje', width: 13 },
    ]

    const productMap = new Map<
      string,
      { sku: string; producto: string; marca: string; quoteIds: Set<string>; cantidad: number; montoUSD: number }
    >()

    for (const it of mainItems) {
      const key = it.productId || `manual:${it.manualSku || it.description || 'sin-descripcion'}`
      const entry = productMap.get(key) || {
        sku: it.product?.sku || it.manualSku || '',
        producto: it.product?.name || it.description || '',
        marca: it.product?.brand || it.manualBrand || '',
        quoteIds: new Set<string>(),
        cantidad: 0,
        montoUSD: 0,
      }
      entry.quoteIds.add(it.quoteId)
      entry.cantidad += it.quantity
      entry.montoUSD += Number(it.totalPrice)
      productMap.set(key, entry)
    }

    const productEntries = Array.from(productMap.values()).sort((a, b) => b.montoUSD - a.montoUSD)

    for (const p of productEntries) {
      ws2.addRow({
        sku: p.sku,
        producto: p.producto,
        marca: p.marca,
        veces: p.quoteIds.size,
        cantidad: p.cantidad,
        montoUSD: p.montoUSD,
        porcentaje: grandTotalUSD > 0 ? p.montoUSD / grandTotalUSD : 0,
      })
    }

    if (productEntries.length > 0) {
      const totalRow = ws2.addRow({
        sku: '',
        producto: 'TOTAL',
        marca: '',
        veces: '',
        cantidad: productEntries.reduce((sum, p) => sum + p.cantidad, 0),
        montoUSD: grandTotalUSD,
        porcentaje: 1,
      })
      totalRow.font = { bold: true }
      ws2.autoFilter = { from: 'A1', to: `G${productEntries.length + 1}` }
    }

    styleHeaderRow(ws2)
    ws2.getColumn('montoUSD').numFmt = '#,##0.00'
    ws2.getColumn('porcentaje').numFmt = '0.0%'

    // -------- HOJA 3: Resumen por Marca --------
    const ws3 = workbook.addWorksheet('Resumen por Marca')
    ws3.columns = [
      { header: 'Marca', key: 'marca', width: 25 },
      { header: 'Ítems Cotizados', key: 'items', width: 16 },
      { header: 'Cantidad Total', key: 'cantidad', width: 15 },
      { header: 'Monto Total USD', key: 'montoUSD', width: 17 },
      { header: '% del Monto', key: 'porcentaje', width: 13 },
    ]

    const marcaMap = new Map<string, { items: number; cantidad: number; montoUSD: number }>()
    for (const it of mainItems) {
      const marca = it.product?.brand || it.manualBrand || 'Sin marca'
      const entry = marcaMap.get(marca) || { items: 0, cantidad: 0, montoUSD: 0 }
      entry.items++
      entry.cantidad += it.quantity
      entry.montoUSD += Number(it.totalPrice)
      marcaMap.set(marca, entry)
    }

    const marcaEntries = Array.from(marcaMap.entries()).sort((a, b) => b[1].montoUSD - a[1].montoUSD)
    for (const [marca, data] of marcaEntries) {
      ws3.addRow({
        marca,
        items: data.items,
        cantidad: data.cantidad,
        montoUSD: data.montoUSD,
        porcentaje: grandTotalUSD > 0 ? data.montoUSD / grandTotalUSD : 0,
      })
    }

    styleHeaderRow(ws3)
    ws3.getColumn('montoUSD').numFmt = '#,##0.00'
    ws3.getColumn('porcentaje').numFmt = '0.0%'

    // -------- HOJA 4: Resumen por Cliente --------
    const ws4 = workbook.addWorksheet('Resumen por Cliente')
    ws4.columns = [
      { header: 'Cliente', key: 'cliente', width: 35 },
      { header: 'Cotizaciones', key: 'cotizaciones', width: 14 },
      { header: 'Ítems Cotizados', key: 'items', width: 16 },
      { header: 'Monto Total USD', key: 'montoUSD', width: 17 },
      { header: '% del Monto', key: 'porcentaje', width: 13 },
    ]

    const clienteMap = new Map<string, { quoteIds: Set<string>; items: number; montoUSD: number }>()
    for (const it of mainItems) {
      const cliente = it.quote.customer.name
      const entry = clienteMap.get(cliente) || { quoteIds: new Set<string>(), items: 0, montoUSD: 0 }
      entry.quoteIds.add(it.quoteId)
      entry.items++
      entry.montoUSD += Number(it.totalPrice)
      clienteMap.set(cliente, entry)
    }

    const clienteEntries = Array.from(clienteMap.entries()).sort((a, b) => b[1].montoUSD - a[1].montoUSD)
    for (const [cliente, data] of clienteEntries) {
      ws4.addRow({
        cliente,
        cotizaciones: data.quoteIds.size,
        items: data.items,
        montoUSD: data.montoUSD,
        porcentaje: grandTotalUSD > 0 ? data.montoUSD / grandTotalUSD : 0,
      })
    }

    styleHeaderRow(ws4)
    ws4.getColumn('montoUSD').numFmt = '#,##0.00'
    ws4.getColumn('porcentaje').numFmt = '0.0%'

    // ======================== ENVIAR ========================
    const buffer = await workbook.xlsx.writeBuffer()

    const today = getLocalDateString().replace(/-/g, '')
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Analisis_Cotizado_${today}.xlsx"`,
      },
    })
  } catch (error) {
    logger.error('Error generating cotizado report:', error)
    return NextResponse.json(
      { error: 'Error al generar reporte de cotizado' },
      { status: 500 }
    )
  }
}

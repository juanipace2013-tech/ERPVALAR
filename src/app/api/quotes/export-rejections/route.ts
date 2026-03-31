/**
 * GET /api/quotes/export-rejections
 * Genera un Excel con análisis de cotizaciones rechazadas (3 hojas).
 *
 * Query params:
 *   desde  – fecha inicio (YYYY-MM-DD)
 *   hasta  – fecha fin   (YYYY-MM-DD)
 *   vendedor – salesPersonId (omitir o vacío = todos)
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getLocalDateString } from '@/lib/utils'
import ExcelJS from 'exceljs'
import { logger } from '@/lib/logger'

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

/** Separa "Motivo - detalle" en [motivo, detalle] */
function splitReason(reason: string | null): [string, string] {
  if (!reason) return ['Sin motivo', '']
  const idx = reason.indexOf(' - ')
  if (idx === -1) return [reason, '']
  return [reason.substring(0, idx), reason.substring(idx + 3)]
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

    // ---------- Filtros de fecha ----------
    const dateFilter: Record<string, Date> = {}
    if (desde) dateFilter.gte = new Date(desde)
    if (hasta) {
      const end = new Date(hasta)
      end.setHours(23, 59, 59, 999)
      dateFilter.lte = end
    }
    const dateWhere = Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}

    // ---------- Hoja 1: Detalle Rechazos ----------
    const rejected = await prisma.quote.findMany({
      where: {
        status: 'REJECTED',
        ...(vendedorId ? { salesPersonId: vendedorId } : {}),
        ...dateWhere,
      },
      include: {
        customer: { select: { name: true } },
        salesPerson: { select: { name: true } },
      },
      orderBy: { date: 'desc' },
    })

    // ---------- Hoja 3: necesita TODAS las cotizaciones para % rechazo ----------
    const allQuotes = await prisma.quote.findMany({
      where: {
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        ...(vendedorId ? { salesPersonId: vendedorId } : {}),
        ...dateWhere,
      },
      include: {
        salesPerson: { select: { id: true, name: true } },
      },
    })

    // ======================== GENERAR EXCEL ========================
    const workbook = new ExcelJS.Workbook()

    // -------- HOJA 1: Detalle Rechazos --------
    const ws1 = workbook.addWorksheet('Detalle Rechazos')
    ws1.columns = [
      { header: 'Nº Cotización', key: 'quoteNumber', width: 18 },
      { header: 'Fecha', key: 'date', width: 14 },
      { header: 'Cliente', key: 'customer', width: 30 },
      { header: 'Vendedor', key: 'salesPerson', width: 20 },
      { header: 'Total USD', key: 'totalUSD', width: 16 },
      { header: 'Motivo', key: 'motivo', width: 28 },
      { header: 'Detalle', key: 'detalle', width: 35 },
      { header: 'Fecha Rechazo', key: 'fechaRechazo', width: 16 },
    ]

    for (const q of rejected) {
      const [motivo, detalle] = splitReason(q.rejectionReason)
      ws1.addRow({
        quoteNumber: q.quoteNumber,
        date: q.date.toLocaleDateString('es-AR'),
        customer: q.customer.name,
        salesPerson: q.salesPerson.name,
        totalUSD: Number(q.total),
        motivo,
        detalle,
        fechaRechazo: q.statusUpdatedAt
          ? q.statusUpdatedAt.toLocaleDateString('es-AR')
          : q.responseDate
            ? q.responseDate.toLocaleDateString('es-AR')
            : '',
      })
    }

    styleHeaderRow(ws1)
    if (rejected.length > 0) {
      ws1.autoFilter = { from: 'A1', to: `H${rejected.length + 1}` }
    }
    // Formatear columna Total USD
    ws1.getColumn('totalUSD').numFmt = '#,##0.00'

    // -------- HOJA 2: Resumen por Motivo --------
    const ws2 = workbook.addWorksheet('Resumen por Motivo')
    ws2.columns = [
      { header: 'Motivo', key: 'motivo', width: 32 },
      { header: 'Cantidad', key: 'cantidad', width: 12 },
      { header: '% del Total', key: 'porcentaje', width: 14 },
      { header: 'Monto Total USD Perdido', key: 'montoUSD', width: 24 },
    ]

    // Agrupar por motivo
    const motivoMap = new Map<string, { count: number; totalUSD: number }>()
    for (const q of rejected) {
      const [motivo] = splitReason(q.rejectionReason)
      const entry = motivoMap.get(motivo) || { count: 0, totalUSD: 0 }
      entry.count++
      entry.totalUSD += Number(q.total)
      motivoMap.set(motivo, entry)
    }

    const totalRejected = rejected.length
    // Ordenar por cantidad descendente
    const motivoEntries = Array.from(motivoMap.entries()).sort((a, b) => b[1].count - a[1].count)

    for (const [motivo, data] of motivoEntries) {
      ws2.addRow({
        motivo,
        cantidad: data.count,
        porcentaje: totalRejected > 0 ? data.count / totalRejected : 0,
        montoUSD: data.totalUSD,
      })
    }

    // Fila de totales
    if (motivoEntries.length > 0) {
      const totalRow = ws2.addRow({
        motivo: 'TOTAL',
        cantidad: totalRejected,
        porcentaje: 1,
        montoUSD: rejected.reduce((sum, q) => sum + Number(q.total), 0),
      })
      totalRow.font = { bold: true }
    }

    styleHeaderRow(ws2)
    ws2.getColumn('porcentaje').numFmt = '0.0%'
    ws2.getColumn('montoUSD').numFmt = '#,##0.00'

    // -------- HOJA 3: Resumen por Vendedor --------
    const ws3 = workbook.addWorksheet('Resumen por Vendedor')
    ws3.columns = [
      { header: 'Vendedor', key: 'vendedor', width: 25 },
      { header: 'Total Cotizaciones', key: 'totalCot', width: 20 },
      { header: 'Rechazadas', key: 'rechazadas', width: 14 },
      { header: '% Rechazo', key: 'porcentaje', width: 14 },
      { header: 'Motivo Principal', key: 'motivoPrincipal', width: 28 },
    ]

    // Agrupar por vendedor
    const vendedorMap = new Map<
      string,
      {
        name: string
        total: number
        rejected: number
        motivos: Map<string, number>
      }
    >()

    for (const q of allQuotes) {
      const key = q.salesPerson.id
      const entry = vendedorMap.get(key) || {
        name: q.salesPerson.name,
        total: 0,
        rejected: 0,
        motivos: new Map<string, number>(),
      }
      entry.total++
      if (q.status === 'REJECTED') {
        entry.rejected++
        const [motivo] = splitReason(q.rejectionReason)
        entry.motivos.set(motivo, (entry.motivos.get(motivo) || 0) + 1)
      }
      vendedorMap.set(key, entry)
    }

    // Ordenar por % rechazo descendente
    const vendedorEntries = Array.from(vendedorMap.values()).sort(
      (a, b) => (b.rejected / b.total) - (a.rejected / a.total)
    )

    for (const v of vendedorEntries) {
      // Motivo más frecuente
      let motivoPrincipal = '—'
      let maxCount = 0
      for (const [motivo, count] of v.motivos) {
        if (count > maxCount) {
          maxCount = count
          motivoPrincipal = motivo
        }
      }

      ws3.addRow({
        vendedor: v.name,
        totalCot: v.total,
        rechazadas: v.rejected,
        porcentaje: v.total > 0 ? v.rejected / v.total : 0,
        motivoPrincipal: v.rejected > 0 ? motivoPrincipal : '—',
      })
    }

    styleHeaderRow(ws3)
    ws3.getColumn('porcentaje').numFmt = '0.0%'

    // ======================== ENVIAR ========================
    const buffer = await workbook.xlsx.writeBuffer()

    const today = getLocalDateString().replace(/-/g, '')
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Analisis_Rechazos_${today}.xlsx"`,
      },
    })
  } catch (error) {
    logger.error('Error generating rejections report:', error)
    return NextResponse.json(
      { error: 'Error al generar reporte de rechazos' },
      { status: 500 }
    )
  }
}

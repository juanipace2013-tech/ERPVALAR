/**
 * GET /api/comisiones/liquidaciones/[id]/export
 * Descarga la planilla de la liquidación en Excel (2 hojas):
 *   1. Planilla – una fila por línea (facturas y NC), con fila TOTAL
 *   2. Resumen  – totales, tasa, básico, ajustes, neto y split del pago
 */

import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

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

function styleHeaderRow(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1)
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  row.height = 24
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const liq = await prisma.comisionLiquidacion.findUnique({
      where: { id },
      include: {
        vendedor: { select: { name: true } },
        lineas: {
          orderBy: { createdAt: 'asc' },
          include: { facturaParcial: { select: { fecha: true } } },
        },
        ajustes: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!liq) {
      return NextResponse.json({ error: 'Liquidación no encontrada' }, { status: 404 })
    }

    const workbook = new ExcelJS.Workbook()

    // -------- HOJA 1: Planilla --------
    const ws = workbook.addWorksheet('Planilla')
    ws.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Cliente', key: 'cliente', width: 35 },
      { header: 'Presupuesto', key: 'presupuesto', width: 16 },
      { header: 'Factura', key: 'factura', width: 16 },
      { header: 'Importe USD', key: 'importeUsd', width: 14 },
      { header: 'Tipo', key: 'tipo', width: 10 },
      { header: 'TC', key: 'tc', width: 10 },
      { header: 'Comisión USD', key: 'comisionUsd', width: 14 },
      { header: 'Comisión ARS', key: 'comisionArs', width: 16 },
    ]

    // Mismo orden que la planilla en pantalla: por fecha ascendente
    const lineas = [...liq.lineas].sort((a, b) => {
      const fa = (a.facturaParcial?.fecha ?? a.fecha)?.getTime() ?? 0
      const fb = (b.facturaParcial?.fecha ?? b.fecha)?.getTime() ?? 0
      return fa - fb
    })

    for (const l of lineas) {
      const fecha = l.facturaParcial?.fecha ?? l.fecha
      const esNC = Number(l.importeFacturadoUsd ?? 0) < 0
      const row = ws.addRow({
        fecha: fecha ? fecha.toLocaleDateString('es-AR') : '',
        cliente: l.clienteNombre,
        presupuesto: l.presupuesto,
        factura: l.numeroFactura || 'S/F',
        importeUsd: l.importeFacturadoUsd != null ? Number(l.importeFacturadoUsd) : null,
        tipo: l.tipoOperacion === 'DIVISA' ? 'Divisa' : 'Billete',
        tc: l.tipoCambio != null ? Number(l.tipoCambio) : null,
        comisionUsd: l.comisionUsd != null ? Number(l.comisionUsd) : null,
        comisionArs: l.comisionArs != null ? Number(l.comisionArs) : null,
      })
      if (esNC) {
        row.eachCell((cell) => {
          cell.font = { color: { argb: 'FFC00000' } }
        })
      }
    }

    const totalRow = ws.addRow({
      cliente: 'TOTAL',
      importeUsd: Number(liq.totalFacturadoUsd),
      comisionUsd: lineas.reduce((s, l) => s + Number(l.comisionUsd ?? 0), 0),
      comisionArs: Number(liq.comisionesArs),
    })
    totalRow.font = { bold: true }

    styleHeaderRow(ws)
    if (lineas.length > 0) {
      ws.autoFilter = { from: 'A1', to: `I${lineas.length + 1}` }
    }
    ws.getColumn('importeUsd').numFmt = '#,##0.00'
    ws.getColumn('tc').numFmt = '#,##0.00'
    ws.getColumn('comisionUsd').numFmt = '#,##0.00'
    ws.getColumn('comisionArs').numFmt = '#,##0.00'

    // -------- HOJA 2: Resumen --------
    const ws2 = workbook.addWorksheet('Resumen')
    ws2.columns = [
      { header: 'Concepto', key: 'concepto', width: 35 },
      { header: 'Valor', key: 'valor', width: 22 },
    ]

    const filas: [string, string | number | null][] = [
      ['Vendedor', liq.vendedor.name],
      ['Mes', `${MESES[liq.mes - 1]} ${liq.anio}`],
      ['Estado', liq.estado],
      ['Total facturado USD', Number(liq.totalFacturadoUsd)],
      ['Tasa del mes', liq.tasaMes != null ? `${(Number(liq.tasaMes) * 100).toFixed(2)}%` : '—'],
      ['Comisiones ARS', Number(liq.comisionesArs)],
      ['Básico ARS', Number(liq.basicoArs)],
    ]
    for (const a of liq.ajustes) {
      filas.push([`Ajuste: ${a.concepto}`, Number(a.montoArs)])
    }
    filas.push(['Neto ARS', Number(liq.netoArs)])
    if (liq.efectivoArs != null) filas.push(['Pagado en efectivo ARS', Number(liq.efectivoArs)])
    if (liq.mlArs != null) filas.push(['Pagado por ML ARS', Number(liq.mlArs)])
    if (liq.cerradaEn) filas.push(['Cerrada el', liq.cerradaEn.toLocaleDateString('es-AR')])
    if (liq.notas) filas.push(['Notas', liq.notas])

    for (const [concepto, valor] of filas) {
      const row = ws2.addRow({ concepto, valor })
      if (concepto === 'Neto ARS') row.font = { bold: true }
      if (typeof valor === 'number') row.getCell('valor').numFmt = '#,##0.00'
    }
    styleHeaderRow(ws2)

    // -------- Enviar --------
    const buffer = await workbook.xlsx.writeBuffer()
    const vendedorSlug = liq.vendedor.name.replace(/\s+/g, '_')
    const mesStr = `${liq.anio}-${String(liq.mes).padStart(2, '0')}`
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Comisiones_${vendedorSlug}_${mesStr}.xlsx"`,
      },
    })
  } catch (e) {
    logger.error('[comisiones/liquidaciones/[id]/export] GET error', e)
    return NextResponse.json({ error: 'Error generando el Excel' }, { status: 500 })
  }
}

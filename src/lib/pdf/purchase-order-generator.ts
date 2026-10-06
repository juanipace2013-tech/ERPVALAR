import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { getLogo } from '@/lib/logo-base64'

export interface PurchaseOrderPDFData {
  orderNumber: string
  orderDate: Date
  expectedDate?: Date | null
  currency: string
  supplier: {
    name: string
    legalName?: string | null
    taxId?: string | null
    address?: string | null
    email?: string | null
  }
  buyer: {
    name: string
    email: string
    phone?: string | null
  }
  items: Array<{
    code?: string | null
    description: string
    quantity: number
    unitCost: number
    /** Porcentaje 0-100 */
    discount: number
    /** Porcentaje 0-100 */
    taxRate: number
  }>
  notes?: string | null
}

const PAGE_WIDTH = 210
const PAGE_HEIGHT = 297
const MARGIN_LEFT = 10
const MARGIN_RIGHT = 10
const MARGIN_BOTTOM = 20
const USABLE_BOTTOM = PAGE_HEIGHT - MARGIN_BOTTOM
const USABLE_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT
const CONTINUATION_TOP = 20
const BLUE: [number, number, number] = [0, 102, 204]
const RIGHT_COL = 108

// Datos fiscales de Val Arg (constancia ARCA): la factura del proveedor va a este domicilio
const VALARG = {
  razonSocial: 'VAL ARG S.R.L.',
  cuit: '30-71537357-9',
  condicionIva: 'IVA Responsable Inscripto',
  domicilioFiscal: 'Arcos 2388, Piso 1, Dpto. B (C1428) - C.A.B.A.',
  deposito: '14 de Julio 175 - Paternal (C1427) - C.A.B.A.',
  telefono: '+54 11 4551-3343 | 4552-2874',
}

const CURRENCY_PREFIX: Record<string, string> = { ARS: '$', USD: 'USD', EUR: 'EUR' }

function fmtMoney(n: number, currency: string): string {
  const prefix = CURRENCY_PREFIX[currency] || currency
  return `${prefix} ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtNumber(n: number): string {
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 })
}

// orderDate/expectedDate se guardan como medianoche UTC del día elegido en el form
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Totales calculados desde los items: bruto, descuentos, neto gravado e IVA por alícuota */
export function computePurchaseOrderTotals(items: PurchaseOrderPDFData['items']) {
  let gross = 0
  let discount = 0
  const taxByRate = new Map<number, number>()
  for (const item of items) {
    const lineGross = item.quantity * item.unitCost
    const lineDiscount = lineGross * (item.discount / 100)
    const lineNet = lineGross - lineDiscount
    gross += lineGross
    discount += lineDiscount
    taxByRate.set(item.taxRate, (taxByRate.get(item.taxRate) || 0) + lineNet * (item.taxRate / 100))
  }
  const net = gross - discount
  const taxes = [...taxByRate.entries()]
    .filter(([rate]) => rate > 0)
    .sort(([a], [b]) => b - a)
    .map(([rate, amount]) => ({ rate, amount: round2(amount) }))
  const taxTotal = taxes.reduce((s, t) => s + t.amount, 0)
  return {
    gross: round2(gross),
    discount: round2(discount),
    net: round2(net),
    taxes,
    total: round2(net + taxTotal),
  }
}

function addPageNumbersAndHeaders(doc: jsPDF, orderNumber: string, continuationPages: number[]) {
  const totalPages = doc.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(130, 130, 130)
    doc.text(`Página ${i} de ${totalPages}`, PAGE_WIDTH / 2, PAGE_HEIGHT - 8, { align: 'center' })
    if (continuationPages.includes(i)) {
      doc.setFontSize(9)
      doc.setTextColor(100, 100, 100)
      doc.text(
        `Orden de Compra ${orderNumber} — Continuación (Pág ${i} de ${totalPages})`,
        PAGE_WIDTH - MARGIN_RIGHT,
        12,
        { align: 'right' }
      )
    }
  }
  doc.setTextColor(0, 0, 0)
}

/** Header de primera página: logo, N° de OC, proveedor + comprador, datos de facturación */
function drawFirstPageHeader(doc: jsPDF, data: PurchaseOrderPDFData, logo: string): number {
  if (logo) doc.addImage(logo, 'PNG', MARGIN_LEFT, 10, 45, 13.5, undefined, 'SLOW')

  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...BLUE)
  doc.text('ORDEN DE COMPRA', 200, 15, { align: 'right' })
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(11)
  doc.text(data.orderNumber, 200, 21, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(formatDate(data.orderDate), 200, 27, { align: 'right' })

  doc.setFontSize(9)
  doc.text(VALARG.deposito, MARGIN_LEFT, 35)
  doc.text(`Teléfono: ${VALARG.telefono}`, MARGIN_LEFT, 40)
  doc.text(`${VALARG.razonSocial} CUIT: ${VALARG.cuit}`, MARGIN_LEFT, 45)

  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.3)
  doc.line(MARGIN_LEFT, 50, PAGE_WIDTH - MARGIN_RIGHT, 50)

  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(120, 120, 120)
  doc.text('PROVEEDOR', MARGIN_LEFT, 54)
  doc.text('COMPRADOR', RIGHT_COL, 54)

  const maxLeftWidth = RIGHT_COL - MARGIN_LEFT - 5

  // Proveedor
  doc.setFontSize(11)
  doc.setTextColor(0, 0, 0)
  const nameLines = doc.splitTextToSize((data.supplier.legalName || data.supplier.name).toUpperCase(), maxLeftWidth)
  doc.text(nameLines, MARGIN_LEFT, 59)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  let yLeft = 59 + nameLines.length * 5
  if (data.supplier.taxId) {
    doc.text(`CUIT: ${data.supplier.taxId}`, MARGIN_LEFT, yLeft)
    yLeft += 5
  }
  if (data.supplier.address) {
    const addressLines = doc.splitTextToSize(`Dirección: ${data.supplier.address}`, maxLeftWidth)
    doc.text(addressLines, MARGIN_LEFT, yLeft)
    yLeft += addressLines.length * 4 + 1
  }
  if (data.supplier.email) {
    doc.text(`Email: ${data.supplier.email}`, MARGIN_LEFT, yLeft)
    yLeft += 5
  }

  // Comprador
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(data.buyer.name, RIGHT_COL, 59)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Email: ${data.buyer.email}`, RIGHT_COL, 64)
  let yRight = 69
  if (data.buyer.phone) {
    doc.text(`Tel: ${data.buyer.phone}`, RIGHT_COL, yRight)
    yRight += 5
  }

  const y = Math.max(yLeft, yRight)
  doc.setDrawColor(220, 220, 220)
  doc.line(RIGHT_COL - 3, 50, RIGHT_COL - 3, y + 1)
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.3)
  doc.line(MARGIN_LEFT, y + 3, PAGE_WIDTH - MARGIN_RIGHT, y + 3)

  // Datos de facturación
  let nextY = y + 9
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('Facturar a:', MARGIN_LEFT, nextY)
  const labelWidth = doc.getTextWidth('Facturar a: ')
  doc.setFont('helvetica', 'normal')
  const billingLines: string[] = doc.splitTextToSize(
    `${VALARG.razonSocial} - CUIT ${VALARG.cuit} - ${VALARG.condicionIva} - Domicilio fiscal: ${VALARG.domicilioFiscal}`,
    USABLE_WIDTH - labelWidth
  )
  doc.text(billingLines, MARGIN_LEFT + labelWidth, nextY)
  nextY += billingLines.length * 4 + 5

  doc.setFontSize(10)
  doc.text('Por medio de la presente les solicitamos la provisión de los siguientes ítems:', MARGIN_LEFT, nextY)
  return nextY + 5
}

export async function generatePurchaseOrderPDF(data: PurchaseOrderPDFData): Promise<Blob> {
  const doc = new jsPDF()
  const continuationPages: number[] = []
  const { currency } = data

  const logo = await getLogo().catch(() => '')
  const tableStartY = drawFirstPageHeader(doc, data, logo)

  const hasCodes = data.items.some((i) => i.code)
  const hasDiscount = data.items.some((i) => i.discount > 0)

  const head = [
    'Item',
    ...(hasCodes ? ['Código'] : []),
    'Descripción',
    'Cant.',
    'Precio\n(Unitario)',
    ...(hasDiscount ? ['Desc.'] : []),
    'Precio\n(Total)',
  ]
  const body = data.items.map((item, idx) => {
    const lineNet = item.quantity * item.unitCost * (1 - item.discount / 100)
    return [
      String(idx + 1),
      ...(hasCodes ? [item.code || '-'] : []),
      item.description,
      fmtNumber(item.quantity),
      fmtMoney(item.unitCost, currency),
      ...(hasDiscount ? [item.discount > 0 ? `${fmtNumber(item.discount)}%` : '-'] : []),
      fmtMoney(lineNet, currency),
    ]
  })

  // Anchos fijos para números; la descripción se lleva el resto
  const fixed = 12 + (hasCodes ? 28 : 0) + 15 + 29 + (hasDiscount ? 14 : 0) + 29
  const columnStyles: Record<number, { halign?: 'center' | 'right'; cellWidth: number }> = {}
  let col = 0
  columnStyles[col++] = { halign: 'center', cellWidth: 12 }
  if (hasCodes) columnStyles[col++] = { halign: 'center', cellWidth: 28 }
  columnStyles[col++] = { cellWidth: USABLE_WIDTH - fixed }
  columnStyles[col++] = { halign: 'center', cellWidth: 15 }
  columnStyles[col++] = { halign: 'right', cellWidth: 29 }
  if (hasDiscount) columnStyles[col++] = { halign: 'center', cellWidth: 14 }
  columnStyles[col++] = { halign: 'right', cellWidth: 29 }

  autoTable(doc, {
    startY: tableStartY,
    head: [head],
    body,
    theme: 'grid',
    headStyles: { fillColor: BLUE, textColor: 255, fontSize: 9, halign: 'center' },
    bodyStyles: { fontSize: 8 },
    columnStyles,
    margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT, bottom: MARGIN_BOTTOM, top: CONTINUATION_TOP },
    rowPageBreak: 'avoid',
    didDrawPage: (hookData) => {
      if (hookData.pageNumber > 1) continuationPages.push(doc.getNumberOfPages())
    },
  })

  // ── Totales ──
  const totals = computePurchaseOrderTotals(data.items)
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Subtotal:', value: fmtMoney(totals.gross, currency) },
  ]
  if (totals.discount > 0) {
    rows.push({ label: 'Descuento:', value: `- ${fmtMoney(totals.discount, currency)}` })
    rows.push({ label: 'Neto gravado:', value: fmtMoney(totals.net, currency) })
  }
  for (const t of totals.taxes) {
    rows.push({ label: `IVA ${fmtNumber(t.rate)}%:`, value: fmtMoney(t.amount, currency) })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let curY = (doc as any).lastAutoTable.finalY
  if (curY + 15 + rows.length * 6 > USABLE_BOTTOM) {
    doc.addPage()
    continuationPages.push(doc.getNumberOfPages())
    curY = CONTINUATION_TOP
  }

  const totalsRight = PAGE_WIDTH - MARGIN_RIGHT
  const GAP = 4
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  let rowsWidth = Math.max(...rows.map((r) => doc.getTextWidth(r.label) + GAP + doc.getTextWidth(r.value)))
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  rowsWidth = Math.max(rowsWidth, doc.getTextWidth('Total:') + GAP + doc.getTextWidth(fmtMoney(totals.total, currency)))
  const totalsLeft = Math.min(totalsRight - 58, totalsRight - (rowsWidth + 7))

  doc.setDrawColor(...BLUE)
  doc.setLineWidth(0.5)
  doc.line(totalsLeft, curY + 2, totalsRight, curY + 2)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(0, 0, 0)
  let rowY = curY + 8
  for (const r of rows) {
    doc.text(r.label, totalsLeft + 6, rowY)
    doc.text(r.value, totalsRight - 1, rowY, { align: 'right' })
    rowY += 6
  }

  doc.setLineWidth(0.8)
  doc.line(totalsLeft, rowY - 3, totalsRight, rowY - 3)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Total:', totalsLeft + 6, rowY + 3)
  doc.text(fmtMoney(totals.total, currency), totalsRight - 1, rowY + 3, { align: 'right' })
  doc.setLineWidth(0.3)
  doc.line(totalsLeft, rowY + 5, totalsRight, rowY + 5)
  curY = rowY + 12

  // ── Observaciones (texto libre de la OC: referencia de la oferta, plazos, certificados...) ──
  doc.setFont('helvetica', 'normal')
  if (data.notes?.trim()) {
    doc.setFontSize(9)
    const noteLines: string[] = doc.splitTextToSize(data.notes.trim(), USABLE_WIDTH)
    if (curY + 8 + Math.min(noteLines.length, 10) * 4.2 > USABLE_BOTTOM) {
      doc.addPage()
      continuationPages.push(doc.getNumberOfPages())
      curY = CONTINUATION_TOP
    }
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Observaciones:', MARGIN_LEFT, curY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    curY += 6
    for (const line of noteLines) {
      if (curY > USABLE_BOTTOM) {
        doc.addPage()
        continuationPages.push(doc.getNumberOfPages())
        curY = CONTINUATION_TOP
      }
      doc.text(line, MARGIN_LEFT, curY)
      curY += 4.2
    }
    curY += 2
  }

  // ── Condiciones generales + firma ──
  const conditions = [
    `Moneda: ${currency === 'ARS' ? 'pesos argentinos' : currency === 'USD' ? 'dólares estadounidenses' : currency}. Los precios no incluyen IVA salvo indicación en contrario.`,
    ...(data.expectedDate ? [`Fecha de entrega requerida: ${formatDate(data.expectedDate)}.`] : []),
    `Indicar el N° de esta orden (${data.orderNumber}) en remito y factura.`,
    'Enviar junto con el material los certificados y la documentación técnica correspondientes.',
    'Les pedimos confirmar por escrito la recepción de esta orden y la fecha de entrega.',
  ]
  doc.setFontSize(9)
  const conditionLines = conditions.flatMap((c) => doc.splitTextToSize(`• ${c}`, USABLE_WIDTH) as string[])
  // 6 del título + líneas + 21 de la firma compacta; puede bajar hasta 14mm del
  // borde (el "Página X de Y" va a 8mm) para no mandar la firma sola a otra hoja
  if (curY + 6 + conditionLines.length * 4.5 + 21 > PAGE_HEIGHT - 14) {
    doc.addPage()
    continuationPages.push(doc.getNumberOfPages())
    curY = CONTINUATION_TOP
  }
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Condiciones:', MARGIN_LEFT, curY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  curY += 6
  for (const line of conditionLines) {
    doc.text(line, MARGIN_LEFT, curY)
    curY += 4.5
  }

  curY += 4
  doc.text('Sin otro particular, los saludamos muy atentamente', MARGIN_LEFT, curY)
  doc.setFont('helvetica', 'bold')
  doc.text(data.buyer.name, MARGIN_LEFT, curY + 8)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`${VALARG.razonSocial} | www.val-ar.com.ar`, MARGIN_LEFT, curY + 12.5)
  doc.text(`${data.buyer.email} | Office: ${VALARG.telefono}`, MARGIN_LEFT, curY + 17)

  addPageNumbersAndHeaders(doc, data.orderNumber, continuationPages)
  return doc.output('blob')
}

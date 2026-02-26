import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { LOGO_BASE64 } from '@/lib/logo-base64'

// ── Interfaces ────────────────────────────────────────────────────────────────
export interface RemitoPDFData {
  deliveryNumber: string
  date: Date
  customer: {
    name: string
    businessName?: string | null
    cuit?: string | null
    address?: string | null
    city?: string | null
    province?: string | null
    taxCondition?: string | null
  }
  items: Array<{
    sku?: string | null
    description: string
    quantity: number
    unit: string
  }>
  carrier?: string | null
  transportAddress?: string | null
  purchaseOrder?: string | null
  bultos?: number | null
  totalAmountARS?: number | null
  notes?: string | null
}

// ── Constantes de página ──────────────────────────────────────────────────────
const PAGE_W = 210
const PAGE_H = 297
const ML = 10 // margin left
const MR = 10 // margin right
const USABLE_W = PAGE_W - ML - MR

const DARK: [number, number, number] = [30, 30, 30]
const BLACK: [number, number, number] = [0, 0, 0]
const GRAY: [number, number, number] = [100, 100, 100]
const LIGHT_GRAY: [number, number, number] = [200, 200, 200]
const TABLE_HEAD_BG: [number, number, number] = [50, 50, 50]
const TABLE_HEAD_FG: [number, number, number] = [255, 255, 255]

const IVA_LABELS: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
  EXENTO: 'Exento',
  MONOTRIBUTO: 'Monotributo',
  CONSUMIDOR_FINAL: 'Consumidor Final',
  NO_RESPONSABLE: 'No Responsable',
  RESPONSABLE_NO_INSCRIPTO: 'Resp. No Inscripto',
}

const MIN_ITEM_ROWS = 12 // mínimo de filas visibles en la tabla (incluye vacías)

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

function fmtARS(n: number): string {
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// ── Dibujar una copia del remito ──────────────────────────────────────────────
function drawRemitoCopy(doc: jsPDF, data: RemitoPDFData, copyLabel: string) {
  let y = 10

  // ══════════════════════════════════════════════════════════════════════════
  // CABECERA — 3 columnas con borde exterior
  // ══════════════════════════════════════════════════════════════════════════
  const headerH = 48
  const headerY = y
  const centerBoxW = 30
  const leftW = (USABLE_W - centerBoxW) * 0.55
  const rightW = USABLE_W - leftW - centerBoxW

  // Borde exterior del header
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.6)
  doc.rect(ML, headerY, USABLE_W, headerH)

  // Líneas verticales interiores
  const centerX = ML + leftW
  const rightX = centerX + centerBoxW
  doc.setLineWidth(0.4)
  doc.line(centerX, headerY, centerX, headerY + headerH)
  doc.line(rightX, headerY, rightX, headerY + headerH)

  // ── Columna izquierda: Logo + datos empresa ──
  try {
    doc.addImage(LOGO_BASE64, 'PNG', ML + 4, headerY + 3, 38, 11)
  } catch {
    // Si falla el logo, texto fallback
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...DARK)
    doc.text('VAL ARG S.R.L.', ML + 4, headerY + 11)
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...DARK)
  doc.text('VAL ARG S.R.L.', ML + 4, headerY + 19)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text('CUIT: 30-71537357-9', ML + 4, headerY + 24)
  doc.text('Ing. Brutos: 901-043862-2', ML + 4, headerY + 28)
  doc.text('Inicio de Act.: 01/03/2019', ML + 4, headerY + 32)
  doc.text('14 de Julio 175, C.P: 1427 – C.A.B.A.', ML + 4, headerY + 36)
  doc.text('Tel: +54 11 4551-3343 / 4552-2874', ML + 4, headerY + 40)
  doc.text('www.val-ar.com.ar', ML + 4, headerY + 44)

  // ── Centro: Letra "R" ──
  const centerMidX = centerX + centerBoxW / 2
  const centerMidY = headerY + headerH / 2

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(42)
  doc.setTextColor(...BLACK)
  doc.text('R', centerMidX, centerMidY - 2, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(...GRAY)
  doc.text('COD. 0991', centerMidX, centerMidY + 8, { align: 'center' })
  doc.text('Documento no válido', centerMidX, centerMidY + 12, { align: 'center' })
  doc.text('como factura', centerMidX, centerMidY + 15, { align: 'center' })

  // ── Columna derecha: Tipo doc + número + fecha + copia ──
  const rx = rightX + 5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...DARK)
  doc.text('REMITO', rx, headerY + 12)

  doc.setFont('courier', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...BLACK)
  doc.text(data.deliveryNumber, rx, headerY + 19)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...DARK)
  doc.text(`Fecha: ${fmtDate(data.date)}`, rx, headerY + 27)

  // Etiqueta de copia (ORIGINAL / DUPLICADO / TRIPLICADO)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(180, 0, 0)
  doc.text(copyLabel, rx, headerY + 35)

  y = headerY + headerH + 4

  // ══════════════════════════════════════════════════════════════════════════
  // DATOS DEL CLIENTE — caja con borde
  // ══════════════════════════════════════════════════════════════════════════
  const clientBoxH = 30
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.4)
  doc.rect(ML, y, USABLE_W, clientBoxH)

  // Línea vertical divisora (60% / 40%)
  const clientDivX = ML + USABLE_W * 0.6
  doc.line(clientDivX, y, clientDivX, y + clientBoxH)

  const cx = ML + 4
  let cy = y + 6

  // Columna izquierda: Señores, Calle, Localidad
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...DARK)
  doc.text('Señor(es):', cx, cy)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(
    (data.customer.businessName || data.customer.name || '').substring(0, 55),
    cx + 22,
    cy
  )

  cy += 6
  doc.setFont('helvetica', 'bold')
  doc.text('Domicilio:', cx, cy)
  doc.setFont('helvetica', 'normal')
  doc.text((data.customer.address || '').substring(0, 55), cx + 22, cy)

  cy += 6
  doc.setFont('helvetica', 'bold')
  doc.text('Localidad:', cx, cy)
  doc.setFont('helvetica', 'normal')
  const localidad = [data.customer.city, data.customer.province]
    .filter(Boolean)
    .join(', ')
  doc.text(localidad.substring(0, 55), cx + 22, cy)

  cy += 6
  doc.setFont('helvetica', 'bold')
  doc.text('Entrega:', cx, cy)
  doc.setFont('helvetica', 'normal')
  doc.text(
    (data.carrier ? `Transporte: ${data.carrier}` : 'Retira en sucursal').substring(0, 55),
    cx + 22,
    cy
  )

  // Columna derecha: IVA, CUIT, O.C.
  const rx2 = clientDivX + 4
  let ry = y + 6

  const ivaLabel = data.customer.taxCondition
    ? IVA_LABELS[data.customer.taxCondition] || data.customer.taxCondition
    : ''

  if (ivaLabel) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('I.V.A.:', rx2, ry)
    doc.setFont('helvetica', 'normal')
    doc.text(ivaLabel, rx2 + 14, ry)
  }

  ry += 6
  if (data.customer.cuit) {
    doc.setFont('helvetica', 'bold')
    doc.text('C.U.I.T.:', rx2, ry)
    doc.setFont('courier', 'normal')
    doc.setFontSize(8)
    doc.text(data.customer.cuit, rx2 + 17, ry)
    doc.setFont('helvetica', 'normal')
  }

  ry += 6
  if (data.purchaseOrder) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('O.C.:', rx2, ry)
    doc.setFont('helvetica', 'normal')
    doc.text(data.purchaseOrder, rx2 + 12, ry)
  }

  ry += 6
  if (data.carrier && data.transportAddress) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.text('Dir. Transp.:', rx2, ry)
    doc.setFont('helvetica', 'normal')
    doc.text(data.transportAddress.substring(0, 30), rx2 + 22, ry)
  }

  y += clientBoxH + 3

  // ══════════════════════════════════════════════════════════════════════════
  // TABLA DE ITEMS
  // ══════════════════════════════════════════════════════════════════════════

  // Construir filas: items reales + filas vacías para completar
  const tableBody: string[][] = data.items.map((item) => [
    item.sku || '',
    item.description || '',
    item.unit || 'UN',
    Number(item.quantity).toString(),
  ])

  // Completar con filas vacías punteadas hasta MIN_ITEM_ROWS
  const emptyRowsNeeded = Math.max(0, MIN_ITEM_ROWS - tableBody.length)
  for (let i = 0; i < emptyRowsNeeded; i++) {
    tableBody.push(['', '', '', ''])
  }

  const tableStartY = y

  autoTable(doc, {
    startY: tableStartY,
    head: [['CÓDIGO', 'DESCRIPCIÓN', 'UNID.', 'CANT.']],
    body: tableBody,
    theme: 'grid',
    tableWidth: USABLE_W,
    margin: { left: ML, right: MR },
    headStyles: {
      fillColor: TABLE_HEAD_BG,
      textColor: TABLE_HEAD_FG,
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'center',
      cellPadding: 2,
    },
    bodyStyles: {
      fontSize: 7.5,
      cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 },
      minCellHeight: 6,
      textColor: DARK,
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 30, font: 'courier', fontStyle: 'bold' },
      1: { halign: 'left', cellWidth: USABLE_W - 30 - 18 - 22 },
      2: { halign: 'center', cellWidth: 18 },
      3: { halign: 'center', cellWidth: 22 },
    },
    // Estilizar filas vacías con línea punteada inferior
    didParseCell: (hookData) => {
      if (hookData.section === 'body') {
        const rowIdx = hookData.row.index
        const isEmptyRow = rowIdx >= data.items.length
        if (isEmptyRow) {
          hookData.cell.styles.lineColor = LIGHT_GRAY
        }
      }
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY

  // ══════════════════════════════════════════════════════════════════════════
  // BULTOS + VALOR DECLARADO
  // ══════════════════════════════════════════════════════════════════════════
  const bultosH = 9
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.4)
  doc.rect(ML, y, USABLE_W, bultosH)

  // Línea vertical al medio
  const bultosDiv = ML + USABLE_W / 2
  doc.line(bultosDiv, y, bultosDiv, y + bultosH)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...DARK)
  doc.text('BULTOS:', ML + 4, y + 6)
  doc.setFont('helvetica', 'normal')
  doc.text(data.bultos != null ? String(data.bultos) : '', ML + 22, y + 6)

  doc.setFont('helvetica', 'bold')
  doc.text('VALOR DECLARADO: $', bultosDiv + 4, y + 6)
  doc.setFont('courier', 'normal')
  doc.text(
    data.totalAmountARS != null ? fmtARS(data.totalAmountARS) : '',
    bultosDiv + 42,
    y + 6
  )

  y += bultosH + 2

  // ══════════════════════════════════════════════════════════════════════════
  // OBSERVACIONES (si hay)
  // ══════════════════════════════════════════════════════════════════════════
  if (data.notes) {
    const obsH = 10
    doc.setDrawColor(...LIGHT_GRAY)
    doc.setLineWidth(0.3)
    doc.rect(ML, y, USABLE_W, obsH)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...GRAY)
    doc.text('Obs.:', ML + 3, y + 5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...DARK)
    doc.text(data.notes.substring(0, 120), ML + 14, y + 5)

    y += obsH + 2
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FIRMAS
  // ══════════════════════════════════════════════════════════════════════════
  const firmaY = Math.max(y + 8, PAGE_H - 68)

  // Línea firma izquierda (Entrega)
  const firmaIzqCenter = ML + USABLE_W * 0.25
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.3)
  doc.line(firmaIzqCenter - 35, firmaY, firmaIzqCenter + 35, firmaY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text('Firma y Aclaración (Entrega)', firmaIzqCenter, firmaY + 4, {
    align: 'center',
  })

  // Línea firma derecha (Recepción)
  const firmaDerCenter = ML + USABLE_W * 0.75
  doc.line(firmaDerCenter - 35, firmaY, firmaDerCenter + 35, firmaY)
  doc.text('Firma y Aclaración (Recepción)', firmaDerCenter, firmaY + 4, {
    align: 'center',
  })

  // ══════════════════════════════════════════════════════════════════════════
  // CAI
  // ══════════════════════════════════════════════════════════════════════════
  const caiY = firmaY + 12
  const caiH = 10
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.3)
  doc.rect(ML, caiY, USABLE_W, caiH)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...DARK)
  doc.text('CAI N°:', ML + 4, caiY + 6)
  // Línea para completar
  doc.setDrawColor(...LIGHT_GRAY)
  doc.line(ML + 18, caiY + 7, ML + 70, caiY + 7)

  doc.setFont('helvetica', 'bold')
  doc.text('Fecha Vto. CAI:', ML + 80, caiY + 6)
  doc.setDrawColor(...LIGHT_GRAY)
  doc.line(ML + 108, caiY + 7, ML + 155, caiY + 7)

  // ══════════════════════════════════════════════════════════════════════════
  // PIE DE PÁGINA
  // ══════════════════════════════════════════════════════════════════════════
  const footerY = caiY + caiH + 4
  doc.setDrawColor(...LIGHT_GRAY)
  doc.setLineWidth(0.2)
  doc.line(ML, footerY, ML + USABLE_W, footerY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(...GRAY)
  doc.text(
    'VAL ARG S.R.L. | CUIT: 30-71537357-9 | 14 de Julio 175, C.P: 1427 – C.A.B.A. | Tel: +54 11 4551-3343 / 4552-2874',
    PAGE_W / 2,
    footerY + 3,
    { align: 'center' }
  )
}

// ── Función principal ─────────────────────────────────────────────────────────
export function generateRemitoPDF(data: RemitoPDFData): Blob {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const copies: string[] = ['ORIGINAL', 'DUPLICADO', 'TRIPLICADO']

  copies.forEach((label, idx) => {
    if (idx > 0) doc.addPage()
    drawRemitoCopy(doc, data, label)
  })

  return doc.output('blob')
}

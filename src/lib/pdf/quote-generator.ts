import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { LOGO_BASE64 } from '@/lib/logo-base64'

interface QuotePDFData {
  quoteNumber: string
  date: Date
  validUntil: Date
  customer: {
    name: string
    legalName?: string
    taxId?: string
    address?: string
  }
  salesPerson: {
    name: string
    email: string
    phone?: string
  }
  items: Array<{
    itemNumber: string
    code: string
    description: string
    brand: string
    quantity: number
    unitPrice: number
    totalPrice: number
    deliveryTime: string
    isAlternative?: boolean
  }>
  subtotal: number
  total: number
  exchangeRate: number
  paymentTerms: string
  validityDays: number
}

const PAGE_WIDTH = 210
const PAGE_HEIGHT = 297
const MARGIN_LEFT = 10
const MARGIN_RIGHT = 10
const MARGIN_BOTTOM = 20
const USABLE_BOTTOM = PAGE_HEIGHT - MARGIN_BOTTOM
const CONTINUATION_TOP = 20 // Top margin for continuation pages (space for header text)
const BLUE: [number, number, number] = [0, 102, 204]

function fmtUSD(n: number): string {
  return `USD ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(date)
}

/**
 * Final pass: adds "Página X de Y" footer on ALL pages,
 * and continuation header text (no logo) on tracked continuation pages.
 */
function addPageNumbersAndHeaders(
  doc: jsPDF,
  quoteNumber: string,
  continuationPages: number[]
) {
  const totalPages = doc.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    // Footer — all pages
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(130, 130, 130)
    doc.text(
      `Página ${i} de ${totalPages}`,
      PAGE_WIDTH / 2,
      PAGE_HEIGHT - 8,
      { align: 'center' }
    )
    // Continuation header — NO logo, just text top-right
    if (continuationPages.includes(i)) {
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(100, 100, 100)
      doc.text(
        `Oferta: ${quoteNumber} — Continuación (Pág ${i} de ${totalPages})`,
        PAGE_WIDTH - MARGIN_RIGHT,
        12,
        { align: 'right' }
      )
    }
  }
  doc.setTextColor(0, 0, 0)
}

const RIGHT_COL = 108 // X start for right column (vendedor)

/** Dibuja header de primera página: logo, datos empresa, cliente + vendedor */
function drawFirstPageHeader(doc: jsPDF, data: QuotePDFData): number {
  // Logo
  doc.addImage(LOGO_BASE64, 'PNG', MARGIN_LEFT, 10, 45, 13.5)

  // Header derecho
  doc.setFontSize(10)
  doc.setTextColor(0, 0, 0)
  doc.text(formatDate(data.date), 200, 15, { align: 'right' })
  doc.setFont('helvetica', 'bold')
  doc.text(`Oferta: ${data.quoteNumber}`, 200, 20, { align: 'right' })
  doc.setFont('helvetica', 'normal')

  // Datos de VAL ARG
  doc.setFontSize(9)
  doc.text('14 de Julio 175, C.P: 1427 - C.A.B.A.', MARGIN_LEFT, 35)
  doc.text('Teléfono: + 54 11 4551-3343 | 4552-2874', MARGIN_LEFT, 40)
  doc.text('VAL ARG S.R.L. CUIT: 30-71537357-9', MARGIN_LEFT, 45)

  // Separador horizontal
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.3)
  doc.line(MARGIN_LEFT, 50, PAGE_WIDTH - MARGIN_RIGHT, 50)

  // ── Etiquetas de sección ──
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(120, 120, 120)
  doc.text('CLIENTE', MARGIN_LEFT, 54)
  doc.text('VENDEDOR', RIGHT_COL, 54)

  // Línea vertical separadora entre columnas
  doc.setDrawColor(220, 220, 220)
  doc.line(RIGHT_COL - 3, 50, RIGHT_COL - 3, 80)

  // ── Columna izquierda: Cliente ──
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text((data.customer.legalName || data.customer.name).toUpperCase(), MARGIN_LEFT, 59)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  let y = 64
  if (data.customer.taxId) {
    doc.text(`CUIT: ${data.customer.taxId}`, MARGIN_LEFT, y)
    y += 5
  }
  if (data.customer.address) {
    doc.text(`Dirección: ${data.customer.address}`, MARGIN_LEFT, y)
    y += 5
  }

  // ── Columna derecha: Vendedor ──
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text(data.salesPerson.name, RIGHT_COL, 59)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Email: ${data.salesPerson.email}`, RIGHT_COL, 64)
  if (data.salesPerson.phone) {
    doc.text(`Tel: ${data.salesPerson.phone}`, RIGHT_COL, 69)
  }

  // Separador horizontal inferior
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.3)
  doc.line(MARGIN_LEFT, y + 3, PAGE_WIDTH - MARGIN_RIGHT, y + 3)

  // Intro
  doc.setFontSize(10)
  doc.setTextColor(0, 0, 0)
  doc.text('Por medio de la presente tenemos el agrado de cotizarles los siguientes ítems:', MARGIN_LEFT, y + 10)

  return y + 18 // startY para la tabla
}

export async function generateQuotePDF(data: QuotePDFData): Promise<Blob> {
  const doc = new jsPDF()

  // Track which PDF pages are "continuation" pages (no logo, just text header)
  const continuationPages: number[] = []

  // ═══════════════════════════════════════════════════════════════════════
  // PÁGINA 1+ — COTIZACIÓN CON TABLA PAGINADA
  // ═══════════════════════════════════════════════════════════════════════

  const tableStartY = drawFirstPageHeader(doc, data)

  // Tabla de items — autoTable maneja paginación automáticamente
  const tableData = data.items.map(item => [
    item.itemNumber,
    item.code,
    `${item.description}\nMarca: ${item.brand}`,
    item.quantity.toString(),
    fmtUSD(item.unitPrice),
    fmtUSD(item.totalPrice),
    item.deliveryTime
  ])

  autoTable(doc, {
    startY: tableStartY,
    head: [[
      'Item',
      'Código',
      'Descripción',
      'Cantidad',
      'Precio\n(Unitario)',
      'Precio\n(Total)',
      'Plazo de\nentrega'
    ]],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: BLUE,
      textColor: 255,
      fontSize: 9,
      halign: 'center'
    },
    bodyStyles: {
      fontSize: 8
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      1: { halign: 'center', cellWidth: 22 },
      2: { cellWidth: 62 },
      3: { halign: 'center', cellWidth: 18 },
      4: { halign: 'right', cellWidth: 23 },
      5: { halign: 'right', cellWidth: 23 },
      6: { halign: 'center', cellWidth: 20 }
    },
    // top: space for continuation header text on pages 2+
    // startY overrides top on page 1
    margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT, bottom: MARGIN_BOTTOM, top: CONTINUATION_TOP },
    // NEVER split a row across pages — move entire row to next page
    rowPageBreak: 'avoid',
    // Style alternative items
    didParseCell: (hookData) => {
      if (hookData.section === 'body') {
        const itemData = data.items[hookData.row.index]
        if (itemData?.isAlternative) {
          hookData.cell.styles.fillColor = [240, 244, 248]
          hookData.cell.styles.textColor = [100, 116, 139]
          hookData.cell.styles.fontStyle = 'italic'
        }
      }
    },
    // Track continuation pages (headers drawn in final pass with page totals)
    didDrawPage: (hookData) => {
      if (hookData.pageNumber > 1) {
        continuationPages.push(doc.getNumberOfPages())
      }
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // SUBTOTAL / TOTAL — alineados bajo columna "Precio (Total)"
  // ═══════════════════════════════════════════════════════════════════════

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let curY = (doc as any).lastAutoTable.finalY

  // Verificar si hay espacio para subtotal/total + condiciones (~80mm)
  const spaceNeeded = 75
  if (curY + spaceNeeded > USABLE_BOTTOM) {
    doc.addPage()
    continuationPages.push(doc.getNumberOfPages())
    curY = CONTINUATION_TOP
  }

  // Coordenadas X: columna "Precio Total" va de x≈147 a x≈170
  const totalsLeft = 124
  const totalsRight = 170

  // Línea separadora bajo la tabla
  doc.setDrawColor(...BLUE)
  doc.setLineWidth(0.5)
  doc.line(totalsLeft, curY + 2, totalsRight, curY + 2)

  // Subtotal
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(0, 0, 0)
  doc.text('Subtotal:', totalsLeft + 6, curY + 8)
  doc.text(fmtUSD(data.subtotal), totalsRight - 1, curY + 8, { align: 'right' })

  // Línea separadora antes del total
  doc.setDrawColor(...BLUE)
  doc.setLineWidth(0.8)
  doc.line(totalsLeft, curY + 11, totalsRight, curY + 11)

  // Total
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Total:', totalsLeft + 6, curY + 17)
  doc.text(fmtUSD(data.total), totalsRight - 1, curY + 17, { align: 'right' })

  // Línea final
  doc.setLineWidth(0.3)
  doc.line(totalsLeft, curY + 19, totalsRight, curY + 19)

  curY += 25

  // ═══════════════════════════════════════════════════════════════════════
  // CONDICIONES COMERCIALES + FIRMA
  // ═══════════════════════════════════════════════════════════════════════

  // Verificar espacio (~60mm para condiciones + firma)
  if (curY + 60 > USABLE_BOTTOM) {
    doc.addPage()
    continuationPages.push(doc.getNumberOfPages())
    curY = CONTINUATION_TOP
  }

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text('Condiciones comerciales:', MARGIN_LEFT, curY + 3)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)

  const conditions = [
    'Los precios No incluyen IVA (21%) y estan expresados en dólares americanos cotización BNA billete vendedor.',
    `Validez de la oferta: ${data.validityDays} días.`,
    'Lugar de entrega: 14 de Julio 175 - Paternal. CABA',
    `Condición de pago: ${data.paymentTerms}`,
    'Si hubiere una diferencia de cambio ±3% entre la fecha real de acreditación de los fondos y la fecha de',
    'emisión de la factura, nos veremos obligados a la emisión de una nota de débito o de crédito',
    'correspondiente a dicha diferencia.'
  ]

  curY += 8
  conditions.forEach(line => {
    doc.text(line, MARGIN_LEFT, curY)
    curY += 5
  })

  // Firma
  curY += 5
  if (curY + 40 > USABLE_BOTTOM) {
    doc.addPage()
    continuationPages.push(doc.getNumberOfPages())
    curY = CONTINUATION_TOP
  }

  doc.text('Sin otro particular, le saluda muy atentamente', MARGIN_LEFT, curY)
  doc.setFont('helvetica', 'bold')
  doc.text(data.salesPerson.name, MARGIN_LEFT, curY + 10)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('Office: + 54 (11) 4552-2874 | 4551-3343', MARGIN_LEFT, curY + 15)
  doc.text('www.val-ar.com.ar', MARGIN_LEFT, curY + 20)
  doc.text(data.salesPerson.email, MARGIN_LEFT, curY + 25)

  // ═══════════════════════════════════════════════════════════════════════
  // PÁGINA FINAL — TÉRMINOS Y CONDICIONES (SIEMPRE NUEVA PÁGINA)
  // ═══════════════════════════════════════════════════════════════════════

  doc.addPage()

  // Logo (only on T&C page and page 1)
  doc.addImage(LOGO_BASE64, 'PNG', MARGIN_LEFT, 10, 45, 13.5)

  // Header
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text('VAL ARG S.R.L.', MARGIN_LEFT, 40)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('14 de Julio 175, Ciudad Autónoma de Buenos Aires (CP 1427)', MARGIN_LEFT, 45)
  doc.text('Teléfono +54 11 4551-3343', MARGIN_LEFT, 50)

  // Título
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Términos y Condiciones Generales de Cotización de Precios de Materiales', MARGIN_LEFT, 60)

  // Secciones
  doc.setFontSize(10)
  let termsY = 70

  const sections = [
    {
      title: 'General',
      content: 'VAL ARG S.R.L. efectúa la provisión de acuerdo a los requerimientos del Comprador, y en ningún caso será responsable por la mala interpretación de especificaciones técnicas vinculadas al material cotizado o derivados de la presente cotización. El material cotizado deberá ser objeto de aprobación técnica por parte del comprador, interpretándose su conformidad con la orden de compra correspondiente.\n\nVAL ARG S.R.L. no será, bajo ninguna circunstancia, responsable ante la otra parte por lucro cesante, por las consecuencias mediatas, remotas o indirectas de los daños y perjuicios que se pudieren ocasionar con relación a la presente cotización de materiales. A todos los fines y supuestos, VAL ARG S.R.L. limita su responsabilidad en virtud de la presente al doble del monto aquí cotizado del material que originó el perjuicio.'
    },
    {
      title: 'Precios',
      content: 'Los precios detallados en la presente cotización serán validos exclusivamente en caso de adjudicación total de los materiales y cantidades indicadas. Los precios estarán sujetos a modificación en caso de que hubiere cambios en las especificaciones, cantidades o requerimientos de los materiales aquí cotizados.\n\nSalvo acuerdo por escrito en caso contrario, los precios indicados en la presente cotización no incluyen condiciones especiales de pintura, embalaje, ensayos, pruebas e inspección por parte del cliente o de terceras partes.'
    },
    {
      title: 'Aceptación',
      content: 'No existirá compromiso alguno entre VAL ARG S.R.L. y el comprador, hasta que la orden sea aceptada por escrito.\n\nCon la aceptación por escrito de la orden de compra por parte de VAL ARG S.R.L., estos términos y condiciones, así como aquellos establecidos de común acuerdo con el comprador, constituyen un compromiso para el suministro del material descrito en la presente cotización, el cual solo podrá ser modificado por escrito.'
    },
    {
      title: 'Pago',
      content: 'Mora: La falta de pago en término de las facturas que emitiera VAL ARG S.R.L.., facultará a VAL ARG S.R.L. a reclamar el pago de un interés compensatorio equivalente a dos veces la Tasa Activa del Banco de la Nación Argentina S.A. para Operaciones de Descuento, sobre el saldo deudor, hasta que se haga efectivo el pago de las mismas.'
    },
    {
      title: 'Garantía',
      content: 'Los usos y servicios normales, quedarán establecidos a través de las especificaciones técnicas y condiciones de servicio por parte del cliente. Este material se entiende aceptado y apto para la aplicación por parte del cliente al ordenarlo.\n\nNinguna garantía mantendrá su vigencia para productos o componentes, que habiendo sido entregados en condiciones óptimas, hubiesen sido objeto de uso o instalación inadecuada, mal almacenados, modificados o reparados por personal no autorizado por VAL ARG S.R.L.\n\nTodo gasto incurrido en la reparación o inspección de materiales, que estando dentro del período de garantía, hubieren resultado dañados por mal uso, mala instalación o maltrato, serán facturados al cliente en su totalidad.'
    },
    {
      title: 'Ley y Jurisdicción',
      content: 'La validez, ejecución de esta cotización y de la contratación resultante se regirá por las leyes de la República Argentina. A todos los efectos, serán competentes en forma exclusiva los Tribunales Ordinarios Nacionales en lo Comercial de la Ciudad Autónoma de Buenos Aires.'
    },
    {
      title: 'Domicilio',
      content: 'Los domicilios indicados en el encabezamiento de este instrumento se tendrán por válidos para todo tipo de emplazamientos, requerimientos y/o notificaciones judiciales o extrajudiciales que en ellos se realicen.'
    }
  ]

  sections.forEach(section => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(section.title, MARGIN_LEFT, termsY)
    termsY += 5

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    const lines = doc.splitTextToSize(section.content, PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT)
    doc.text(lines, MARGIN_LEFT, termsY)
    termsY += lines.length * 3.5 + 3
  })

  // Footer T&C
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('14 de Julio 175 - C.P: 1427 - C.A.B.A.', PAGE_WIDTH / 2, 285, { align: 'center' })
  doc.text('TE:(011) 4551-3343 | 4552-2874', PAGE_WIDTH / 2, 290, { align: 'center' })

  // ═══════════════════════════════════════════════════════════════════════
  // FINAL PASS: page numbers on ALL pages + continuation headers
  // ═══════════════════════════════════════════════════════════════════════
  addPageNumbersAndHeaders(doc, data.quoteNumber, continuationPages)

  return doc.output('blob')
}

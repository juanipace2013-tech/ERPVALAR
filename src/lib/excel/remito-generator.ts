import ExcelJS from 'exceljs'

// ============================================================================
// Interfaz de datos para el generador de remito Excel
// ============================================================================

export interface RemitoExcelData {
  deliveryNumber: string       // "00002-00011367"
  date: Date
  customer: {
    businessName: string       // Razón social
    address: string            // Dirección
    city: string               // Localidad (puede incluir provincia)
    cuit: string               // CUIT
  }
  purchaseOrder: string | null
  customerInvoiceNumber: string | null
  items: Array<{
    sku: string
    description: string
    quantity: number
  }>
  bultos: number | null
  totalAmountARS: number | null
}

// ============================================================================
// Constantes de layout (copiadas exactas del template preimpreso)
// ============================================================================

const ITEMS_PER_PAGE = 9

// Anchos de columna (A-Q)
const COLUMN_WIDTHS = [
  6.29,   // A
  11.71,  // B
  4.0,    // C
  3.57,   // D
  2.29,   // E
  5.0,    // F
  5.71,   // G
  5.0,    // H
  2.71,   // I
  16.71,  // J
  4.14,   // K
  1.14,   // L
  6.29,   // M
  6.0,    // N
  5.57,   // O
  1.86,   // P
  2.43,   // Q
]

// Alturas de fila (1-20)
const ROW_HEIGHTS: Record<number, number> = {
  1: 64.9, 2: 90.0, 3: 26.25, 4: 5.25, 5: 30.75,
  6: 33.0, 7: 22.9, 8: 27.0,
  9: 24.75, 10: 24.75, 11: 24.75, 12: 24.75, 13: 24.75,
  14: 24.75, 15: 24.75, 16: 24.75, 17: 24.75,
  18: 20.25, 19: 20.25, 20: 27.75,
}

// Fuentes
const FONT_DEFAULT: Partial<ExcelJS.Font> = { name: 'Arial', size: 10 }
const FONT_OC: Partial<ExcelJS.Font> = { name: 'Arial', size: 11, bold: true }
const FONT_BOLD_12: Partial<ExcelJS.Font> = { name: 'Arial', size: 12, bold: true }

// ============================================================================
// Función principal
// ============================================================================

/**
 * Genera un archivo Excel (.xlsx) con los datos del remito posicionados
 * para imprimir sobre hojas de remito preimpresas.
 */
export async function generateRemitoExcel(data: RemitoExcelData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()

  // Dividir items en páginas de 9
  const pages: Array<typeof data.items> = []
  for (let i = 0; i < data.items.length; i += ITEMS_PER_PAGE) {
    pages.push(data.items.slice(i, i + ITEMS_PER_PAGE))
  }
  if (pages.length === 0) pages.push([]) // Al menos una hoja aunque no haya items

  pages.forEach((pageItems, pageIndex) => {
    const sheetName = pageIndex === 0
      ? 'Remito'
      : `Remito (cont. ${pageIndex + 1})`
    const ws = workbook.addWorksheet(sheetName)
    buildRemitoSheet(ws, data, pageItems, pageIndex)
  })

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

// ============================================================================
// Builder de cada hoja
// ============================================================================

function buildRemitoSheet(
  ws: ExcelJS.Worksheet,
  data: RemitoExcelData,
  pageItems: RemitoExcelData['items'],
  _pageIndex: number,
) {
  // ----- Configuración de página -----
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: 'portrait',
    margins: {
      top: 0.748,
      bottom: 0.748,
      left: 0.236,
      right: 0.236,
      header: 0.3,
      footer: 0.3,
    },
  }

  // ----- Anchos de columna -----
  ws.columns = COLUMN_WIDTHS.map((width) => ({ width }))

  // ----- Alturas de fila -----
  for (const [row, height] of Object.entries(ROW_HEIGHTS)) {
    ws.getRow(Number(row)).height = height
  }

  // ----- Fila 1: Solo fecha (el número de remito ya está en el preimpreso) -----
  const d = data.date
  setCell(ws, 'M1', d.getDate(), FONT_DEFAULT)
  setCell(ws, 'N1', d.getMonth() + 1, FONT_DEFAULT)
  setCell(ws, 'O1', d.getFullYear() % 100, FONT_DEFAULT)
  // P1:Q1 = Número de remito — NO se pone, ya viene en la hoja preimpresa

  // ----- Fila 2: Razón social del cliente -----
  ws.mergeCells('C2:K2')
  setCell(ws, 'C2', data.customer.businessName, FONT_DEFAULT, {
    vertical: 'middle',
    wrapText: true,
  })

  // ----- Fila 3: Dirección + Localidad -----
  ws.mergeCells('C3:J3')
  setCell(ws, 'C3', data.customer.address, FONT_DEFAULT, { vertical: 'middle' })

  ws.mergeCells('L3:Q3')
  setCell(ws, 'L3', data.customer.city, FONT_DEFAULT, { vertical: 'middle' })

  // ----- Fila 5: CUIT -----
  ws.mergeCells('N5:Q5')
  setCell(ws, 'N5', data.customer.cuit, FONT_DEFAULT, { vertical: 'middle' })

  // ----- Fila 6: Número de factura -----
  ws.mergeCells('N6:Q6')
  setCell(ws, 'N6', data.customerInvoiceNumber || '', FONT_DEFAULT, { vertical: 'middle' })

  // ----- Fila 8: Orden de compra -----
  setCell(ws, 'B8', 'OC N°:', FONT_OC, { vertical: 'middle' })
  ws.mergeCells('C8:L8')
  setCell(ws, 'C8', data.purchaseOrder || '', FONT_OC, { vertical: 'middle' })

  // ----- Filas 9-17: Items (hasta 9 por página) -----
  for (let i = 0; i < ITEMS_PER_PAGE; i++) {
    const row = 9 + i
    const item = pageItems[i]

    // SKU en columna B
    setCell(ws, `B${row}`, item?.sku || '', FONT_DEFAULT, { vertical: 'middle' })

    // Descripción en C:N (merge)
    ws.mergeCells(`C${row}:N${row}`)
    setCell(ws, `C${row}`, item?.description || '', FONT_DEFAULT, {
      vertical: 'middle',
      wrapText: true,
    })

    // Cantidad en O:Q (merge)
    ws.mergeCells(`O${row}:Q${row}`)
    if (item) {
      setCell(ws, `O${row}`, item.quantity, FONT_DEFAULT, {
        vertical: 'middle',
        horizontal: 'center',
      })
    }
  }

  // ----- Fila 18: Bultos -----
  setCell(ws, 'B18', 'BULTOS:', FONT_BOLD_12, { vertical: 'middle' })
  ws.mergeCells('C18:J18')
  setCell(
    ws,
    'C18',
    data.bultos != null ? data.bultos : '',
    FONT_BOLD_12,
    { vertical: 'middle' },
  )

  // ----- Fila 19: Valor declarado -----
  setCell(ws, 'B19', 'VD $:', FONT_BOLD_12, { vertical: 'middle' })
  ws.mergeCells('C19:J19')
  const valorDeclarado = data.totalAmountARS != null
    ? formatARS(data.totalAmountARS)
    : ''
  setCell(ws, 'C19', valorDeclarado, FONT_BOLD_12, { vertical: 'middle' })
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Asigna valor, fuente y alignment a una celda.
 */
function setCell(
  ws: ExcelJS.Worksheet,
  ref: string,
  value: string | number,
  font: Partial<ExcelJS.Font>,
  alignment?: Partial<ExcelJS.Alignment>,
) {
  const cell = ws.getCell(ref)
  cell.value = value
  cell.font = font as ExcelJS.Font
  if (alignment) {
    cell.alignment = alignment as ExcelJS.Alignment
  }
}

/**
 * Formatea número como moneda argentina: 1.234.567,89
 */
function formatARS(amount: number): string {
  return amount.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

import { jsPDF } from 'jspdf'

/**
 * Generador de certificados de calibración de válvulas en el formato VALAR
 * moderno (banda navy con logo, píldora roja, secciones subrayadas en rojo,
 * tablas cebradas). Una página por válvula certificada.
 *
 * El diseño replica el de los certificados de calidad consolidados (agosto
 * 2026) y reemplaza al certificado clásico en blanco y negro.
 */

export interface CertificadoCalibracionData {
  cliente: string
  referencia: string // ej. "Cot. VAL-2026-2373" u "OC N° 4746"
  fecha: Date
  /** Números grabados en las válvulas: una página por cada uno */
  valvulas: string[]
  /** Texto de la píldora roja, ej. "CERTIFICADO DE CALIBRACIÓN Y PRUEBA NEUMÁTICA" */
  tituloPill: string
  /** Título grande, ej. "VÁLVULA DE SEGURIDAD" */
  titulo: string
  /** Subtítulo rojo, ej. "2\" x 3\"  -  SERIE 150  -  AISI 304  (Flanged Safety Valve)" */
  subtitulo: string
  /** Línea gris de especificación resumida */
  specline: string
  /** Párrafo descriptivo */
  descripcion: string
  /** Fila extra de identificación, ej. "VALAR · Seguridad" */
  marcaTipo: string
  materiales: Array<[string, string]>
  calibracion: Array<[string, string]>
  conexiones: Array<[string, string]>
  encargado: { nombre: string; rol: string }
  /** Base64 data-URI del logo blanco con transparencia (public/logo-valarg-blanco.png) */
  logoBase64: string
}

const NAVY: [number, number, number] = [31, 56, 100]
const RED: [number, number, number] = [200, 16, 46]
const PILL: [number, number, number] = [207, 46, 73]
const TXT: [number, number, number] = [38, 48, 60]
const GRAY: [number, number, number] = [92, 101, 115]
const LABEL: [number, number, number] = [61, 74, 92]
const ZEBRA: [number, number, number] = [242, 244, 247]
const ROW_BORDER: [number, number, number] = [227, 231, 237]
const GREEN: [number, number, number] = [30, 122, 52]
const BOX_BORDER: [number, number, number] = [207, 214, 223]
const CELESTE: [number, number, number] = [116, 172, 223]

const M_LEFT = 12
const M_RIGHT = 198
const WIDTH = M_RIGHT - M_LEFT

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

/** Encabezado de sección: texto navy en mayúsculas con subrayado rojo. */
function sectionHeading(doc: jsPDF, x: number, y: number, text: string): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...NAVY)
  doc.text(text, x, y)
  doc.setFillColor(...RED)
  doc.rect(x, y + 1.6, doc.getTextWidth(text) + 2, 1, 'F')
  return y + 5.5
}

/** Tabla clave/valor cebrada. Devuelve la Y final. */
function kvTable(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  labelWidth: number,
  rows: Array<[string, string]>
): number {
  const rowH = 7
  rows.forEach(([label, value], i) => {
    if (i % 2 === 1) {
      doc.setFillColor(...ZEBRA)
      doc.rect(x, y, width, rowH, 'F')
    }
    doc.setDrawColor(...ROW_BORDER)
    doc.setLineWidth(0.2)
    doc.line(x, y + rowH, x + width, y + rowH)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.6)
    doc.setTextColor(...LABEL)
    doc.text(label, x + 3, y + rowH / 2 + 1.4)
    if (value === 'APROBADO' || value === 'PASS') {
      doc.setTextColor(...GREEN)
    } else {
      doc.setTextColor(...TXT)
    }
    doc.text(value, x + labelWidth, y + rowH / 2 + 1.4)
    y += rowH
  })
  return y
}

/** Tabla con fila de encabezado navy y cuerpo cebrado. Devuelve la Y final. */
function headerTable(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  colSplit: number,
  header: [string, string],
  rows: Array<[string, string]>
): number {
  const rowH = 6.8
  doc.setFillColor(...NAVY)
  doc.rect(x, y, width, rowH, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(255, 255, 255)
  doc.text(header[0], x + 3, y + rowH / 2 + 1.4)
  doc.text(header[1], x + colSplit, y + rowH / 2 + 1.4)
  y += rowH
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...TXT)
  rows.forEach(([a, b], i) => {
    if (i % 2 === 1) {
      doc.setFillColor(...ZEBRA)
      doc.rect(x, y, width, rowH, 'F')
    }
    doc.setDrawColor(...ROW_BORDER)
    doc.setLineWidth(0.2)
    doc.line(x, y + rowH, x + width, y + rowH)
    doc.setFontSize(9.6)
    doc.text(a, x + 3, y + rowH / 2 + 1.4)
    doc.text(b, x + colSplit, y + rowH / 2 + 1.4)
    y += rowH
  })
  return y
}

function drawPage(doc: jsPDF, data: CertificadoCalibracionData, valvula: string) {
  // ---- Banda superior navy ----
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, 210, 48, 'F')
  if (data.logoBase64) {
    // Logo blanco con transparencia, 600x82 px
    doc.addImage(data.logoBase64, 'PNG', M_LEFT, 8.5, 60, 8.2)
  }
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9)
  doc.setTextColor(201, 211, 227)
  doc.text('Distribución de válvulas e instrumentación industrial', M_LEFT, 24.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(170, 183, 204)
  doc.text('VAL ARG S.R.L. · CUIT 30-71537357-9', M_LEFT, 28.7)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(255, 255, 255)
  doc.text('14 de Julio 175, Paternal, CABA', M_RIGHT, 10, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(223, 230, 240)
  doc.text('Tel: +54 (11) 4551-3343 / 4552-2874 · WhatsApp: (11) 6055-1683', M_RIGHT, 15, { align: 'right' })
  doc.text('ventas@val-ar.com.ar · info@val-ar.com.ar', M_RIGHT, 20, { align: 'right' })

  // Píldora roja con el título del certificado
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  const pillTextW = doc.getTextWidth(data.tituloPill)
  const pillW = pillTextW + 14
  doc.setFillColor(...PILL)
  doc.rect(M_RIGHT - pillW, 32.5, pillW, 10, 'F')
  doc.setTextColor(255, 255, 255)
  doc.text(data.tituloPill, M_RIGHT - pillW / 2, 38.8, { align: 'center' })

  // Línea roja separadora
  doc.setFillColor(...RED)
  doc.rect(0, 49.8, 210, 1.6, 'F')

  // ---- Título y descripción ----
  let y = 61
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.setTextColor(...NAVY)
  doc.text(data.titulo, M_LEFT, y)
  y += 6.5
  doc.setFontSize(12)
  doc.setTextColor(...RED)
  doc.text(data.subtitulo, M_LEFT, y)
  y += 5.5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...GRAY)
  doc.text(data.specline, M_LEFT, y)
  y += 6
  doc.setTextColor(...TXT)
  const descLines = doc.splitTextToSize(data.descripcion, WIDTH)
  doc.text(descLines, M_LEFT, y, { maxWidth: WIDTH, align: 'justify' })
  y += descLines.length * 4.4 + 3

  // ---- Identificación ----
  y = sectionHeading(doc, M_LEFT, y + 4, 'IDENTIFICACIÓN')
  y = kvTable(doc, M_LEFT, y, WIDTH, WIDTH * 0.52, [
    ['Identificación del usuario (N° de válvula)', valvula],
    ['Cliente', data.cliente],
    ['Referencia', data.referencia],
    ['Fecha de emisión', formatDate(data.fecha)],
    ['Marca · Tipo de válvula', data.marcaTipo],
  ])

  // ---- Materiales ----
  y = sectionHeading(doc, M_LEFT, y + 7, 'MATERIALES DE CONSTRUCCIÓN')
  y = headerTable(doc, M_LEFT, y, WIDTH, WIDTH * 0.52, ['Componente', 'Material'], data.materiales)

  // ---- Calibración + Conexiones en dos columnas ----
  const colW = (WIDTH - 6) / 2
  const colY = y + 7
  const leftEnd = kvTable(
    doc,
    M_LEFT,
    sectionHeading(doc, M_LEFT, colY, 'CALIBRACIÓN Y SERVICIO'),
    colW,
    colW * 0.55,
    data.calibracion
  )
  const rightEnd = kvTable(
    doc,
    M_LEFT + colW + 6,
    sectionHeading(doc, M_LEFT + colW + 6, colY, 'CONEXIONES Y ACCESORIOS'),
    colW,
    colW * 0.55,
    data.conexiones
  )
  y = Math.max(leftEnd, rightEnd)

  // ---- Caja de aprobación ----
  y += 6
  doc.setDrawColor(...BOX_BORDER)
  doc.setLineWidth(0.4)
  doc.roundedRect(M_LEFT, y, 88, 17, 2, 2, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(139, 149, 163)
  doc.text('APROBACIÓN FINAL — VALAR', M_LEFT + 5, y + 5, { charSpace: 0.3 })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11.5)
  doc.setTextColor(...NAVY)
  doc.text(data.encargado.nombre, M_LEFT + 5, y + 10.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...GRAY)
  doc.text(data.encargado.rol, M_LEFT + 5, y + 14.8)

  // ---- Pie de página ----
  doc.setDrawColor(215, 220, 227)
  doc.setLineWidth(0.4)
  doc.line(M_LEFT, 285, M_RIGHT, 285)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...NAVY)
  const tituloCap = data.titulo.charAt(0) + data.titulo.slice(1).toLowerCase()
  doc.text(`VALAR · Certificado de Calibración — ${tituloCap} · N° ${valvula}`, M_LEFT, 290)
  // Bandera argentina + leyenda
  const flagX = M_RIGHT - doc.getTextWidth('Industria Argentina · www.val-ar.com.ar') - 7
  doc.setFillColor(...CELESTE)
  doc.rect(flagX, 287.2, 4.5, 1, 'F')
  doc.rect(flagX, 289.2, 4.5, 1, 'F')
  doc.setFillColor(255, 255, 255)
  doc.rect(flagX, 288.2, 4.5, 1, 'F')
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GRAY)
  doc.text('Industria Argentina · www.val-ar.com.ar', M_RIGHT, 290, { align: 'right' })
}

export function generateCertificadoCalibracionPDF(data: CertificadoCalibracionData): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  data.valvulas.forEach((valvula, i) => {
    if (i > 0) doc.addPage()
    drawPage(doc, data, valvula)
  })
  return doc
}

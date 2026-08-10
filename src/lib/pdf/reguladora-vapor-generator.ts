import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { getLogo } from '@/lib/logo-base64'
import type { ResultadoCalculo } from '@/lib/calculoReguladoraVapor'

// ── Interfaces ────────────────────────────────────────────────────────────────
export interface ReguladoraVaporPDFData {
  resultado: ResultadoCalculo
  cliente?: string
  referencia?: string
  fecha: Date
}

// ── Constantes ────────────────────────────────────────────────────────────────
// Portrait A4
const PAGE_W = 210
const ML = 14
const MR = 14

const DARK: [number, number, number] = [30, 30, 30]
const GRAY: [number, number, number] = [100, 100, 100]
const BLUE: [number, number, number] = [37, 99, 235]
const AMBER: [number, number, number] = [180, 120, 0]
const TABLE_HEAD_BG: [number, number, number] = [50, 50, 50]
const TABLE_HEAD_FG: [number, number, number] = [255, 255, 255]
const HIGHLIGHT_BG: [number, number, number] = [219, 234, 254]

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

function fmt(n: number, decimales = 2): string {
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })
}

function fmtPct(fraccion: number, decimales = 2): string {
  return `${fmt(fraccion * 100, decimales)}%`
}

// Helvetica (WinAnsi) no tiene Δ, ≤ ni ≥: un solo caracter fuera de rango
// garbla la línea completa en jsPDF, así que se reemplazan antes de dibujar.
function pdfSafe(s: string): string {
  return s.replace(/Δ/g, 'Delta ').replace(/≤/g, '<=').replace(/≥/g, '>=')
}

// ── Generador ─────────────────────────────────────────────────────────────────
export async function generateReguladoraVaporPDF(
  data: ReguladoraVaporPDFData
): Promise<Blob> {
  const { resultado: r, cliente, referencia, fecha } = data
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  // ═══ CABECERA (mismo estilo que el PDF de presupuestos) ═══
  const logoBase64 = await getLogo()
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', ML, 10, 45, 13.5)
    } catch {
      // Fallback if logo fails
    }
  }

  const rightX = PAGE_W - MR
  doc.setFontSize(10)
  doc.setTextColor(...DARK)
  doc.setFont('helvetica', 'normal')
  doc.text(fmtDate(fecha), rightX, 15, { align: 'right' })

  doc.setFontSize(9)
  doc.text('14 de Julio 175, C.P: 1427 - C.A.B.A.', ML, 30)
  doc.text('Teléfono: + 54 11 4551-3343 | 4552-2874', ML, 35)
  doc.text('VAL ARG S.R.L. CUIT: 30-71537357-9', ML, 40)

  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.3)
  doc.line(ML, 44, PAGE_W - MR, 44)

  let y = 51
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...DARK)
  doc.text('SELECCIÓN DE VÁLVULA REDUCTORA DE PRESIÓN DE VAPOR', PAGE_W / 2, y, {
    align: 'center',
  })
  y += 6
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GRAY)
  doc.text('GENEBRE Art. 2274 (roscada) / 2275 (bridada) — pilotada, vapor saturado', PAGE_W / 2, y, {
    align: 'center',
  })
  y += 8

  // ═══ CLIENTE / REFERENCIA ═══
  if (cliente || referencia) {
    doc.setDrawColor(...GRAY)
    doc.setLineWidth(0.2)
    doc.roundedRect(ML, y, PAGE_W - ML - MR, 14, 1.5, 1.5)
    doc.setFontSize(9)
    doc.setTextColor(...DARK)
    let ly = y + 5.5
    if (cliente) {
      doc.setFont('helvetica', 'bold')
      doc.text('Cliente:', ML + 4, ly)
      doc.setFont('helvetica', 'normal')
      doc.text(cliente, ML + 22, ly)
      ly += 5.5
    }
    if (referencia) {
      doc.setFont('helvetica', 'bold')
      doc.text('Licitación / Ref.:', ML + 4, ly)
      doc.setFont('helvetica', 'normal')
      doc.text(referencia, ML + 34, ly)
    }
    y += 18
  }

  // ═══ CONDICIONES DE SERVICIO ═══
  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['P1 entrada (bar g)', 'P2 regulada (bar g)', 'Q vapor (kg/h)', 'Delta P (bar)', 'P1/2 (bar)', 'Régimen']],
    body: [[fmt(r.p1), fmt(r.p2), fmt(r.q, 0), fmt(r.deltaP), fmt(r.p1Medio), r.regimen]],
    theme: 'grid',
    styles: { fontSize: 8.5, halign: 'center', cellPadding: 1.2 },
    headStyles: { fillColor: TABLE_HEAD_BG, textColor: TABLE_HEAD_FG, fontSize: 8 },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4

  // ═══ RESULTADO ═══
  doc.setFillColor(...HIGHLIGHT_BG)
  doc.roundedRect(ML, y, PAGE_W - ML - MR, 20, 1.5, 1.5, 'F')
  doc.setFontSize(9)
  doc.setTextColor(...DARK)
  doc.setFont('helvetica', 'normal')
  doc.text(`CV calculado: ${fmt(r.cvCalculado)}`, ML + 4, y + 6)
  if (r.seleccion) {
    doc.setTextColor(...DARK)
    doc.text(
      `CV elegido: ${fmt(r.seleccion.cv)}  |  % de trabajo: ${fmtPct(r.seleccion.porcentajeTrabajo)} (banda recomendada 20%–80%)`,
      rightX - 4,
      y + 6,
      { align: 'right' }
    )
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...BLUE)
    doc.text(
      `Medida recomendada: ${r.seleccion.medida} (DN${r.seleccion.dn})`,
      ML + 4,
      y + 14.5
    )
    doc.setFontSize(9)
    doc.setTextColor(...DARK)
    doc.setFont('helvetica', 'normal')
  } else {
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(200, 0, 0)
    doc.text('FUERA DE RANGO — evaluar válvula mayor o dos en paralelo', ML + 4, y + 14)
  }
  y += 24

  // ═══ TABLA DE MEDIDAS ═══
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...DARK)
  doc.text('Medidas disponibles', ML, y)
  y += 2
  const selIdx = r.medidas.findIndex((m) => m.medida === r.seleccion?.medida)
  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['Medida', 'DN', 'Kv (m³/h)', 'CV', '% de trabajo', '']],
    body: r.medidas.map((m, i) => [
      m.medida,
      `DN${m.dn}`,
      fmt(m.kv, 1),
      fmt(m.cv),
      fmtPct(m.porcentajeTrabajo),
      i === selIdx ? 'SELECCIONADA' : '',
    ]),
    theme: 'grid',
    styles: { fontSize: 7.5, halign: 'center', cellPadding: 1.2 },
    headStyles: { fillColor: TABLE_HEAD_BG, textColor: TABLE_HEAD_FG, fontSize: 7.5 },
    didParseCell: (hookData) => {
      if (hookData.section === 'body' && hookData.row.index === selIdx) {
        hookData.cell.styles.fillColor = HIGHLIGHT_BG
        hookData.cell.styles.fontStyle = 'bold'
      }
    },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4

  // ═══ BANDA DE OPERACIÓN ═══
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Banda de operación (20% a 200% del caudal de diseño)', ML, y)
  y += 2
  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['Caudal (kg/h)', 'CV requerido', '% de apertura', '']],
    body: r.banda.map((p) => [
      fmt(p.caudal, 0),
      fmt(p.cv),
      p.porcentajeApertura !== null ? fmtPct(p.porcentajeApertura) : '—',
      p.esDiseno ? 'CAUDAL DE DISEÑO' : '',
    ]),
    theme: 'grid',
    styles: { fontSize: 7.5, halign: 'center', cellPadding: 1 },
    headStyles: { fillColor: TABLE_HEAD_BG, textColor: TABLE_HEAD_FG, fontSize: 7.5 },
    didParseCell: (hookData) => {
      if (hookData.section === 'body' && r.banda[hookData.row.index]?.esDiseno) {
        hookData.cell.styles.fillColor = HIGHLIGHT_BG
        hookData.cell.styles.fontStyle = 'bold'
      }
    },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4

  // ═══ VERIFICACIONES ═══
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...DARK)
  doc.text('Verificaciones (manual GENEBRE)', ML, y)
  y += 2
  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['', 'Verificación', 'Detalle']],
    body: r.verificaciones.map((v) => [
      v.ok ? 'OK' : '¡!',
      pdfSafe(v.descripcion),
      pdfSafe(v.detalle),
    ]),
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 1.2 },
    headStyles: { fillColor: TABLE_HEAD_BG, textColor: TABLE_HEAD_FG, fontSize: 7.5 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12, fontStyle: 'bold' },
      1: { cellWidth: 75 },
    },
    didParseCell: (hookData) => {
      if (hookData.section === 'body' && hookData.column.index === 0) {
        const ok = r.verificaciones[hookData.row.index]?.ok
        hookData.cell.styles.textColor = ok ? [22, 130, 60] : AMBER
      }
    },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4

  // ═══ NOTA DE INSTALACIÓN ═══
  if (y > 280) {
    doc.addPage()
    y = 14
  }
  const nota =
    'Instalación recomendada por GENEBRE: separador de gotas + trampa de vapor, filtro Y aguas arriba, ' +
    'manómetros y válvulas de corte a ambos lados, bypass, y válvula de seguridad a la salida tarada con ' +
    'margen sobre la presión regulada. Tramos rectos de al menos 10 diámetros aguas arriba y abajo.'
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(...GRAY)
  const notaLines = doc.splitTextToSize(nota, PAGE_W - ML - MR)
  doc.text(notaLines, ML, y + 3)

  return doc.output('blob')
}

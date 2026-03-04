import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { LOGO_BASE64 } from '@/lib/logo-base64'

// ── Interfaces ────────────────────────────────────────────────────────────────
export interface RutaPDFData {
  date: Date
  status: string
  notes?: string | null
  createdBy: string
  stops: Array<{
    order: number
    type: string
    customerName: string
    address?: string | null
    city?: string | null
    zone: string
    transportType: string
    transportName?: string | null
    packages: number
    schedule?: string | null
    contactName?: string | null
    contactPhone?: string | null
    finalDestination?: string | null
    observations?: string | null
    deliveryNumber?: string | null
  }>
}

// ── Constantes ────────────────────────────────────────────────────────────────
// Landscape A4
const PAGE_W = 297
const PAGE_H = 210
const ML = 10
const MR = 10
const USABLE_W = PAGE_W - ML - MR

const DARK: [number, number, number] = [30, 30, 30]
const GRAY: [number, number, number] = [100, 100, 100]
const TABLE_HEAD_BG: [number, number, number] = [50, 50, 50]
const TABLE_HEAD_FG: [number, number, number] = [255, 255, 255]

const ZONE_COLORS: Record<string, [number, number, number]> = {
  CABA: [59, 130, 246],    // blue
  NORTE: [34, 197, 94],    // green
  SUR: [239, 68, 68],      // red
  OESTE: [234, 179, 8],    // yellow
}

const ZONE_LABELS: Record<string, string> = {
  CABA: 'CABA',
  NORTE: 'Zona Norte',
  SUR: 'Zona Sur',
  OESTE: 'Zona Oeste',
}

const STATUS_LABELS: Record<string, string> = {
  PLANNING: 'En Planificación',
  IN_PROGRESS: 'En Curso',
  COMPLETED: 'Completada',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

// ── Generador ─────────────────────────────────────────────────────────────────
export function generateRutaPDF(data: RutaPDFData): Blob {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  let y = 10

  // ═══════════════════════════════════════════════════════════════════════════
  // CABECERA
  // ═══════════════════════════════════════════════════════════════════════════
  const headerH = 28

  // Logo
  try {
    doc.addImage(LOGO_BASE64, 'PNG', ML, y, 30, 20)
  } catch {
    // Fallback if logo fails
  }

  // Company info
  doc.setFontSize(10)
  doc.setTextColor(...DARK)
  doc.setFont('helvetica', 'bold')
  doc.text('VAL ARG S.R.L.', ML + 34, y + 5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text('Av. Belgrano 1674, Piso 4 Of. 43 - C.A.B.A.', ML + 34, y + 10)
  doc.text('Tel: (011) 4383-2823 / ventas@val-ar.com.ar', ML + 34, y + 14)

  // Title block
  const titleX = PAGE_W / 2
  doc.setFontSize(18)
  doc.setTextColor(...DARK)
  doc.setFont('helvetica', 'bold')
  doc.text('HOJA DE RUTA', titleX, y + 8, { align: 'center' })

  // Date and metadata
  const rightX = PAGE_W - MR
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(`Fecha: ${fmtDate(data.date)}`, rightX, y + 5, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`Estado: ${STATUS_LABELS[data.status] || data.status}`, rightX, y + 10, { align: 'right' })
  doc.text(`Creado por: ${data.createdBy}`, rightX, y + 15, { align: 'right' })

  y += headerH

  // Horizontal line
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.5)
  doc.line(ML, y, PAGE_W - MR, y)
  y += 4

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLA DE PARADAS — Agrupadas por zona
  // ═══════════════════════════════════════════════════════════════════════════

  // Group stops by zone
  const zones = ['CABA', 'NORTE', 'SUR', 'OESTE']
  const stopsByZone = zones
    .map((zone) => ({
      zone,
      stops: data.stops.filter((s) => s.zone === zone),
    }))
    .filter((g) => g.stops.length > 0)

  // Build table body with zone headers
  const tableBody: any[][] = []

  for (const group of stopsByZone) {
    // Zone header row
    tableBody.push([
      {
        content: `${ZONE_LABELS[group.zone] || group.zone} (${group.stops.length})`,
        colSpan: 10,
        styles: {
          fillColor: ZONE_COLORS[group.zone] || [100, 100, 100],
          textColor: [255, 255, 255] as [number, number, number],
          fontStyle: 'bold' as const,
          fontSize: 8,
          halign: 'left' as const,
        },
      },
    ])

    // Stop rows
    for (const stop of group.stops) {
      const transport =
        stop.transportType === 'OWN'
          ? 'Propio'
          : stop.transportName || 'Tercero'

      const contact = [stop.contactName, stop.contactPhone]
        .filter(Boolean)
        .join(' / ')

      tableBody.push([
        stop.order.toString(),
        stop.type === 'PICKUP' ? '↑ RETIRO' : stop.deliveryNumber || '-',
        stop.customerName,
        [stop.address, stop.city].filter(Boolean).join(', ') || '-',
        transport,
        stop.packages > 0 ? stop.packages.toString() : '-',
        stop.schedule || '-',
        contact || '-',
        stop.finalDestination || '-',
        '', // Firma (empty column for manual signature)
      ])
    }
  }

  autoTable(doc, {
    startY: y,
    head: [
      ['N°', 'Remito', 'Cliente', 'Dirección', 'Transporte', 'Bultos', 'Horario', 'Contacto', 'Destino Final', 'Firma'],
    ],
    body: tableBody,
    theme: 'grid',
    headStyles: {
      fillColor: TABLE_HEAD_BG,
      textColor: TABLE_HEAD_FG,
      fontSize: 7,
      fontStyle: 'bold',
      halign: 'center',
    },
    styles: {
      fontSize: 7,
      cellPadding: 1.5,
      overflow: 'linebreak',
      lineColor: [180, 180, 180],
      lineWidth: 0.2,
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },   // N°
      1: { cellWidth: 28 },                       // Remito
      2: { cellWidth: 40 },                       // Cliente
      3: { cellWidth: 50 },                       // Dirección
      4: { cellWidth: 24 },                       // Transporte
      5: { cellWidth: 14, halign: 'center' },     // Bultos
      6: { cellWidth: 20 },                       // Horario
      7: { cellWidth: 32 },                       // Contacto
      8: { cellWidth: 32 },                       // Destino Final
      9: { cellWidth: 27, halign: 'center' },     // Firma
    },
    margin: { left: ML, right: MR },
    didParseCell: (data) => {
      // Style PICKUP rows differently
      if (data.section === 'body' && data.row.raw) {
        const firstCell = Array.isArray(data.row.raw) ? data.row.raw[1] : ''
        if (firstCell === '↑ RETIRO') {
          data.cell.styles.fontStyle = 'italic'
          data.cell.styles.textColor = [100, 60, 150]
        }
      }
    },
  })

  // Get final Y after table
  const finalY = (doc as any).lastAutoTable?.finalY || y + 50

  // ═══════════════════════════════════════════════════════════════════════════
  // OBSERVACIONES
  // ═══════════════════════════════════════════════════════════════════════════
  let footerY = finalY + 8

  if (data.notes) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...DARK)
    doc.text('Observaciones:', ML, footerY)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...GRAY)
    const lines = doc.splitTextToSize(data.notes, USABLE_W)
    doc.text(lines, ML, footerY + 5)
    footerY += 5 + lines.length * 3.5
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIRMA DEL CONDUCTOR
  // ═══════════════════════════════════════════════════════════════════════════
  footerY += 6

  // Check if we need a new page
  if (footerY > PAGE_H - 30) {
    doc.addPage()
    footerY = 20
  }

  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.3)

  // Driver signature
  const sigWidth = 60
  doc.line(ML, footerY + 10, ML + sigWidth, footerY + 10)
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text('Firma del conductor', ML, footerY + 14)

  // Date
  doc.line(ML + sigWidth + 20, footerY + 10, ML + sigWidth + 80, footerY + 10)
  doc.text('Fecha', ML + sigWidth + 20, footerY + 14)

  // Vehicle
  doc.line(ML + sigWidth + 100, footerY + 10, ML + sigWidth + 180, footerY + 10)
  doc.text('Vehículo / Patente', ML + sigWidth + 100, footerY + 14)

  // ═══════════════════════════════════════════════════════════════════════════
  // RESUMEN AL PIE
  // ═══════════════════════════════════════════════════════════════════════════
  const totalStops = data.stops.length
  const deliveries = data.stops.filter((s) => s.type !== 'PICKUP').length
  const pickups = data.stops.filter((s) => s.type === 'PICKUP').length
  const totalPackages = data.stops.reduce((sum, s) => sum + s.packages, 0)

  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text(
    `Total: ${totalStops} paradas | ${deliveries} entregas | ${pickups} retiros | ${totalPackages} bultos`,
    PAGE_W - MR,
    PAGE_H - 8,
    { align: 'right' }
  )

  return doc.output('blob')
}

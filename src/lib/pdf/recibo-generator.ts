/**
 * PDF del recibo de cobro para mandar al cliente. Mismo estilo que el remito
 * (cabecera VALAR con logo) y las mismas secciones que el recibo de Colppy:
 * comprobantes cobrados, diferencia de cambio, total y valores recibidos.
 * Se arma en el navegador con los datos de GET /api/cobros.
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { getLogo } from '@/lib/logo-base64'
import { numeroALetras } from '@/lib/pdf/factura-generator'

export interface ReciboPDFData {
  /** 0001-00012988 */
  numero: string
  /** YYYY-MM-DD */
  fecha: string
  cliente: {
    nombre: string
    cuit?: string | null
    direccion?: string | null
    localidad?: string | null
    condicionIva?: string | null
  }
  comprobantes: Array<{
    tipo: string
    numero: string
    total: number
    saldoAnterior: number
    /** En pesos, al T/C de la factura */
    importe: number
    /** Solo facturas en dólares */
    usd?: number | null
    tcFactura?: number | null
    tcCobro?: number | null
  }>
  medios: Array<{ medio: string; cuenta: string; importe: number }>
  totalAplicado: number
  totalCobrado: number
  descripcion?: string | null
}

const PAGE_W = 210
const ML = 10
const MR = 10
const USABLE_W = PAGE_W - ML - MR

const DARK: [number, number, number] = [30, 30, 30]
const BLACK: [number, number, number] = [0, 0, 0]
const GRAY: [number, number, number] = [100, 100, 100]
const TABLE_HEAD_BG: [number, number, number] = [50, 50, 50]
const TABLE_HEAD_FG: [number, number, number] = [255, 255, 255]

const IVA_LABELS: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
  EXENTO: 'Exento',
  MONOTRIBUTO: 'Monotributo',
  CONSUMIDOR_FINAL: 'Consumidor Final',
  NO_RESPONSABLE: 'No Responsable',
  RESPONSABLE_NO_INSCRIPTO: 'Resp. No Inscripto',
  CLIENTE_EXTERIOR: 'Cliente del Exterior',
}

const TIPOS: Record<string, string> = { FAV: 'Factura', NDV: 'Nota de débito', NCV: 'Nota de crédito' }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

function fmtARS(n: number): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtTC(n: number): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}
/** YYYY-MM-DD → DD/MM/YYYY sin pasar por Date (evita el corrimiento de huso) */
function fmtFecha(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s
}

/** 1233741.6 → "UN MILLÓN ... PESOS CON 60/100" */
export function importeReciboEnLetras(total: number): string {
  const cent = Math.round(Math.abs(total) * 100)
  const entero = Math.floor(cent / 100)
  const centavos = cent % 100
  const palabras = numeroALetras(entero).replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un')
  const de = entero >= 1_000_000 && entero % 1_000_000 === 0 ? ' de' : ''
  return `${palabras}${de} ${entero === 1 ? 'peso' : 'pesos'} con ${String(centavos).padStart(2, '0')}/100`.toUpperCase()
}

export async function generateReciboPDF(data: ReciboPDFData): Promise<Blob> {
  const logo = await getLogo().catch(() => '')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = 10

  // ── Cabecera: logo y empresa | X | RECIBO ──
  const headerH = 48
  const centerBoxW = 30
  const leftW = (USABLE_W - centerBoxW) * 0.55
  const centerX = ML + leftW
  const rightX = centerX + centerBoxW
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.6)
  doc.rect(ML, y, USABLE_W, headerH)
  doc.setLineWidth(0.4)
  doc.line(centerX, y, centerX, y + headerH)
  doc.line(rightX, y, rightX, y + headerH)

  let conLogo = false
  if (logo) {
    try {
      doc.addImage(logo, 'PNG', ML + 4, y + 3, 38, 11, undefined, 'SLOW')
      conLogo = true
    } catch {
      conLogo = false
    }
  }
  doc.setTextColor(...DARK)
  doc.setFont('helvetica', 'bold')
  if (!conLogo) {
    doc.setFontSize(14)
    doc.text('VAL ARG S.R.L.', ML + 4, y + 11)
  }
  doc.setFontSize(10)
  doc.text('VAL ARG S.R.L.', ML + 4, y + 19)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text('CUIT: 30-71537357-9', ML + 4, y + 24)
  doc.text('IVA: RESPONSABLE INSCRIPTO', ML + 4, y + 28)
  doc.text('Ingresos Brutos: 901-715373579', ML + 4, y + 32)
  doc.text('Inicio de Act.: 04/10/2016', ML + 4, y + 36)
  doc.text('14 de Julio 175, C.P: 1427 – C.A.B.A.', ML + 4, y + 40)
  doc.text('Tel: +54 11 4551-3343 / 4552-2874', ML + 4, y + 44)

  const midX = centerX + centerBoxW / 2
  const midY = y + headerH / 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(42)
  doc.setTextColor(...BLACK)
  doc.text('X', midX, midY - 2, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(...GRAY)
  doc.text('Documento no válido', midX, midY + 9, { align: 'center' })
  doc.text('como factura', midX, midY + 12, { align: 'center' })

  const rx = rightX + 5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...DARK)
  doc.text('RECIBO', rx, y + 12)
  doc.setFont('courier', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...BLACK)
  doc.text(data.numero, rx, y + 19)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...DARK)
  doc.text(`Fecha: ${fmtFecha(data.fecha)}`, rx, y + 27)

  y += headerH + 4

  // ── Cliente ──
  const clienteH = 24
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.4)
  doc.rect(ML, y, USABLE_W, clienteH)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text('RECIBIMOS DE', ML + 4, y + 5)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...DARK)
  doc.text(doc.splitTextToSize(data.cliente.nombre, USABLE_W - 8)[0], ML + 4, y + 11)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  const domicilio = [data.cliente.direccion, data.cliente.localidad].filter(Boolean).join(' – ')
  if (domicilio) doc.text(doc.splitTextToSize(domicilio, USABLE_W - 8)[0], ML + 4, y + 16)
  const fiscal = [data.cliente.cuit ? `CUIT: ${data.cliente.cuit}` : '', data.cliente.condicionIva ? `IVA: ${IVA_LABELS[data.cliente.condicionIva] ?? data.cliente.condicionIva}` : '']
    .filter(Boolean)
    .join('     ')
  if (fiscal) doc.text(fiscal, ML + 4, y + 21)
  y += clienteH + 4

  // ── Importe en letras ──
  const letras = doc.splitTextToSize(importeReciboEnLetras(data.totalCobrado), USABLE_W - 8) as string[]
  const letrasH = 9 + letras.length * 4
  doc.rect(ML, y, USABLE_W, letrasH)
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text('LA SUMA DE', ML + 4, y + 5)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...DARK)
  doc.text(letras, ML + 4, y + 10)
  y += letrasH + 5

  const tabla = (titulo: string, head: string[], body: string[][], alineadas: Record<number, 'right' | 'center'>, foot?: string[]) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...DARK)
    doc.text(titulo, ML, y + 3)
    autoTable(doc, {
      startY: y + 5,
      margin: { left: ML, right: MR },
      head: [head],
      body,
      foot: foot ? [foot] : undefined,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, textColor: DARK, lineColor: [200, 200, 200], lineWidth: 0.2 },
      headStyles: { fillColor: TABLE_HEAD_BG, textColor: TABLE_HEAD_FG, fontStyle: 'bold' },
      footStyles: { fillColor: [240, 240, 240], textColor: DARK, fontStyle: 'bold' },
      columnStyles: Object.fromEntries(Object.entries(alineadas).map(([i, halign]) => [i, { halign }])),
      didParseCell: (c) => {
        const a = alineadas[c.column.index]
        if (a && c.section !== 'body') c.cell.styles.halign = a
      },
    })
    // @ts-expect-error lastAutoTable lo agrega jspdf-autotable
    y = doc.lastAutoTable.finalY + 6
  }

  // ── Comprobantes cobrados ──
  const hayUsd = data.comprobantes.some((c) => c.tcFactura)
  tabla(
    'Comprobantes cobrados',
    ['Comprobante', ...(hayUsd ? ['Importe en USD', 'T/C'] : []), 'Total', 'Saldo anterior', 'Este cobro'],
    data.comprobantes.map((c) => {
      const tc = c.tcCobro || c.tcFactura
      const usd = c.tcFactura ? r2(c.importe / c.tcFactura) : null
      const pesos = c.tcFactura && tc ? r2((c.importe / c.tcFactura) * tc) : c.importe
      return [
        `${TIPOS[c.tipo] ?? c.tipo} ${c.numero}`,
        ...(hayUsd ? [usd !== null ? `USD ${fmtARS(usd)}` : '—', tc ? fmtTC(tc) : '—'] : []),
        fmtARS(c.total),
        fmtARS(c.saldoAnterior),
        fmtARS(pesos),
      ]
    }),
    hayUsd ? { 1: 'right', 2: 'right', 3: 'right', 4: 'right', 5: 'right' } : { 1: 'right', 2: 'right', 3: 'right' },
    ['Total cobrado', ...(hayUsd ? ['', ''] : []), '', '', fmtARS(data.totalCobrado)]
  )
  if (hayUsd) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...GRAY)
    doc.text('Los comprobantes en dólares se cobran en pesos al tipo de cambio indicado. "Total" y "Saldo anterior" están al tipo de cambio de la factura.', ML, y - 2)
    y += 3
  }

  // ── Valores recibidos ──
  tabla(
    'Valores recibidos',
    ['Medio', 'Detalle', 'Importe'],
    data.medios.map((m) => [m.medio, m.cuenta, fmtARS(m.importe)]),
    { 2: 'right' },
    ['Total', '', fmtARS(data.totalCobrado)]
  )

  if (data.descripcion) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...DARK)
    doc.text(doc.splitTextToSize(`Observaciones: ${data.descripcion}`, USABLE_W), ML, y)
    y += 8
  }

  // ── Firma ──
  y = Math.max(y + 18, 250)
  if (y > 280) {
    doc.addPage()
    y = 40
  }
  doc.setDrawColor(...GRAY)
  doc.setLineWidth(0.3)
  doc.line(PAGE_W - MR - 60, y, PAGE_W - MR, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  doc.text('p/ VAL ARG S.R.L.', PAGE_W - MR - 30, y + 4, { align: 'center' })

  return doc.output('blob')
}

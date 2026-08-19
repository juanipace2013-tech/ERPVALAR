/**
 * PDF de factura electrónica emitida por el ERP (ARCA WSFE), con CAE y QR
 * (RG 4892). Layout calcado de las facturas que Colppy emitía para VAL ARG
 * (PV 0003), para que el cliente reciba un comprobante igual al de siempre.
 *
 * Corre del lado del servidor (jsPDF en Node, igual que el PDF de
 * cotizaciones) — ver GET /api/facturas/[id]/pdf.
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import QRCode from 'qrcode'
import { getLogo } from '@/lib/logo-base64'

// ── Tipos ─────────────────────────────────────────────────────────────────────
export interface FacturaPDFData {
  letra: 'A' | 'B' | 'C'
  cbteTipo: number // 1, 6, 3, 8, ...
  clase: 'FACTURA' | 'NOTA DE CRÉDITO' | 'NOTA DE DÉBITO'
  puntoVenta: number
  numero: number
  fecha: Date
  fechaVencimiento?: Date | null
  cae: string
  caeVencimiento: Date
  qrUrl: string
  moneda: 'ARS' | 'USD'
  cotizacion: number // 1 para ARS
  condicionVenta: string // 'Contado', 'Cuenta Corriente'...
  referencia?: string | null // "Cotización VAL-2026-0001"
  observaciones?: string | null
  receptor: {
    nombre: string
    docTipoLabel: string // 'CUIT' | 'DNI' | ''
    docNro: string
    condicionIva: string
    domicilio?: string | null
  }
  items: Array<{
    codigo?: string | null
    descripcion: string
    detalle?: string | null // segunda línea (remito / cotización)
    cantidad: number
    unidad?: string
    precioUnitario: number // neto (A) o final (B), YA con la escala aplicada
    bonifPct?: number
    subtotal: number // neto (A) o final (B), post-bonificación
    alicuotaIva: number // 21
  }>
  totales: {
    netoGravado: number
    netoNoGravado: number
    exento: number
    iva: Array<{ alicuota: number; importe: number }>
    otrosTributos: number
    total: number
  }
  asociados?: Array<{ descripcion: string }>
  isVoided?: boolean
}

// ── Constantes de página / estilo ─────────────────────────────────────────────
const PAGE_W = 210
const PAGE_H = 297
const ML = 10
const MR = 10
const USABLE_W = PAGE_W - ML - MR

const DARK: [number, number, number] = [30, 30, 30]
const BLACK: [number, number, number] = [0, 0, 0]
const GRAY: [number, number, number] = [90, 90, 90]
const TABLE_HEAD_BG: [number, number, number] = [235, 235, 235]

/** Datos del emisor (mismos que el remito; centralizar si se mueven a CompanySettings). */
const EMISOR = {
  fantasia: 'VAL-AR',
  razonSocial: 'VAL ARG S.R.L.',
  cuit: '30-71537357-9',
  condicionIva: 'Resp. Insc.',
  iibb: '901-715373579',
  inicioActividades: '04-10-2016',
  domicilio: '14 de Julio 175 - Paternal - CABA',
}

const CODIGO_CBTE: Record<number, string> = {
  1: '01', 2: '02', 3: '03', 6: '06', 7: '07', 8: '08', 11: '11', 12: '12', 13: '13',
  201: '201', 202: '202', 203: '203', 206: '206', 207: '207', 208: '208',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}-${mm}-${d.getFullYear()}`
}

function fmtNum(n: number, dec = 2): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function fmtCuit(doc: string): string {
  const d = doc.replace(/\D/g, '')
  if (d.length === 11) return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`
  return doc
}

function nroFormateado(pv: number, nro: number): string {
  return `${String(pv).padStart(4, '0')}-${String(nro).padStart(8, '0')}`
}

function claseTitulo(clase: FacturaPDFData['clase']): string {
  if (clase === 'FACTURA') return 'Factura'
  if (clase === 'NOTA DE CRÉDITO') return 'Nota de Crédito'
  return 'Nota de Débito'
}

// ── Número a letras (español) ─────────────────────────────────────────────────
const UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve']
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

function tresCifras(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'cien'
  const c = Math.floor(n / 100)
  const r = n % 100
  let out = CENTENAS[c]
  if (r > 0) {
    if (out) out += ' '
    if (r < 30) out += UNIDADES[r]
    else {
      out += DECENAS[Math.floor(r / 10)]
      if (r % 10) out += ' y ' + UNIDADES[r % 10]
    }
  }
  return out
}

export function numeroALetras(n: number): string {
  const entero = Math.floor(Math.abs(n))
  if (entero === 0) return 'cero'
  const millones = Math.floor(entero / 1_000_000)
  const miles = Math.floor((entero % 1_000_000) / 1000)
  const resto = entero % 1000
  const partes: string[] = []
  if (millones) partes.push(millones === 1 ? 'un millón' : `${tresCifras(millones).replace(/uno$/, 'un')} millones`)
  if (miles) partes.push(miles === 1 ? 'mil' : `${tresCifras(miles).replace(/uno$/, 'un')} mil`)
  if (resto) partes.push(tresCifras(resto))
  return partes.join(' ')
}

/** Importe en letras, siempre en pesos (como el modelo de Colppy: en USD se expresa el equivalente en pesos). */
function importeEnLetras(totalPesos: number): string {
  const entero = Math.floor(totalPesos)
  const centavos = Math.round((totalPesos - entero) * 100)
  let s = `${numeroALetras(entero)} pesos`
  if (centavos > 0) s += ` con ${String(centavos).padStart(2, '0')}/100`
  return s
}

// ── Dibujo ────────────────────────────────────────────────────────────────────
function drawFactura(doc: jsPDF, data: FacturaPDFData, logoBase64: string, qrBase64: string) {
  const esUsd = data.moneda === 'USD'
  const sym = esUsd ? 'USD' : '$'
  const esA = data.letra === 'A'

  // Etiqueta "Negrita: valor" con recorte "…" si no entra
  const label = (t: string, v: string, x: number, yy: number, maxX: number, size = 8) => {
    doc.setFontSize(size)
    doc.setTextColor(...BLACK)
    doc.setFont('helvetica', 'bold')
    doc.text(t, x, yy)
    const w = doc.getTextWidth(t) + 2
    doc.setFont('helvetica', 'normal')
    const maxW = maxX - (x + w)
    let txt = v
    while (txt.length > 3 && doc.getTextWidth(txt) > maxW) txt = txt.slice(0, -2).trimEnd() + '…'
    doc.text(txt, x + w, yy)
  }

  // ═══ CABECERA ═══
  const headerY = 12
  const headerH = 52
  const midX = ML + USABLE_W * 0.47 // separador vertical
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.5)
  doc.rect(ML, headerY, USABLE_W, headerH)
  doc.line(midX, headerY, midX, headerY + headerH)

  // Izquierda: logo + nombre fantasía + datos
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', ML + 28, headerY + 3, 34, 10, undefined, 'SLOW')
    } catch {
      /* sin logo */
    }
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...BLACK)
  doc.text(EMISOR.fantasia, ML + 45, headerY + 27, { align: 'center' })
  label('Razón Social:', EMISOR.razonSocial, ML + 2, headerY + 34, midX - 2, 7.5)
  label('Domicilio Comercial:', EMISOR.domicilio, ML + 2, headerY + 39, midX - 2, 7.5)
  label('Condición Frente al IVA:', EMISOR.condicionIva, ML + 2, headerY + 48, midX - 2, 7.5)

  // Letra en recuadro sobre el separador
  const boxW = 16
  const boxH = 13
  const boxX = midX - boxW / 2
  doc.setFillColor(255, 255, 255)
  doc.rect(boxX, headerY, boxW, boxH, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(data.letra, midX, headerY + 8, { align: 'center' })
  doc.setFontSize(6.5)
  doc.text(`COD ${CODIGO_CBTE[data.cbteTipo] ?? String(data.cbteTipo)}`, midX, headerY + 12, { align: 'center' })

  // Derecha: título + PV/número + fecha + datos fiscales
  const rx = midX + 12
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...BLACK)
  doc.text(claseTitulo(data.clase), rx, headerY + 8)
  doc.setFontSize(8)
  doc.text(`Punto de Venta: ${String(data.puntoVenta).padStart(4, '0')}`, rx, headerY + 14)
  doc.text(`Comp. Nro: ${String(data.numero).padStart(8, '0')}`, rx + 45, headerY + 14)
  doc.text(`Fecha de Emisión: ${fmtDate(data.fecha)}`, rx, headerY + 19)

  label('CUIT:', EMISOR.cuit, rx, headerY + 34, ML + USABLE_W - 2, 7.5)
  label('Ingresos Brutos:', EMISOR.iibb, rx, headerY + 39, ML + USABLE_W - 2, 7.5)
  label('Fecha de Inicio de Actividades:', EMISOR.inicioActividades, rx, headerY + 44, ML + USABLE_W - 2, 7.5)

  // ═══ RECEPTOR ═══
  let y = headerY + headerH + 1.5
  const recH = 22
  doc.setLineWidth(0.5)
  doc.rect(ML, y, USABLE_W, recH)
  const r = data.receptor
  const colL = ML + 5
  const colR = ML + 72
  const docLabel = r.docTipoLabel ? `${r.docTipoLabel} :` : 'Doc :'
  const docVal = r.docTipoLabel === 'CUIT' ? fmtCuit(r.docNro) : r.docNro || '-'
  label(docLabel, docVal, colL, y + 6, colR - 2, 7.5)
  // Razón social: hasta 2 líneas (como el modelo), después recorta
  {
    const t = 'Apellido y Nombre / Razón Social:'
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'bold')
    doc.text(t, colR, y + 6)
    const w = doc.getTextWidth(t) + 2
    doc.setFont('helvetica', 'normal')
    const lines: string[] = doc.splitTextToSize(r.nombre, ML + USABLE_W - 2 - (colR + w))
    if (lines.length > 2) {
      lines.length = 2
      lines[1] = lines[1].replace(/.{2}$/, '…')
    }
    doc.text(lines, colR + w, y + (lines.length > 1 ? 4.5 : 6))
  }
  label('Condición Frente al IVA:', r.condicionIva, colL, y + 12.5, colR - 2, 7.5)
  label('Domicilio Comercial:', r.domicilio || '-', colR, y + 12.5, ML + USABLE_W - 2, 7.5)
  label('Condición de Venta:', data.condicionVenta, colL, y + 19, colR - 2, 7.5)
  label('Fecha Vencimiento:', fmtDate(data.fechaVencimiento ?? data.fecha), colR, y + 19, ML + USABLE_W - 2, 7.5)
  y += recH + 2

  // ═══ ITEMS ═══
  const uSuffix = esUsd ? ' (USD)' : ''
  const head = esA
    ? ['Producto / Servicio', 'Cantidad', 'U. Medida', `Precio Unit.${uSuffix}`, '% Descuento', 'Alícuota IVA', `Subtotal sin IVA${uSuffix}`]
    : ['Producto / Servicio', 'Cantidad', 'U. Medida', `Precio Unit.${uSuffix}`, '% Descuento', `Subtotal${uSuffix}`]

  const body = data.items.map((it) => {
    const desc = `${it.codigo ? `${it.codigo} ` : ''}${it.descripcion}${it.detalle ? `\n${it.detalle}` : ''}`
    const row: string[] = [
      desc,
      fmtNum(it.cantidad, Number.isInteger(it.cantidad) ? 0 : 2),
      it.unidad || 'Un',
      `${esUsd ? '' : '$ '}${fmtNum(it.precioUnitario)}`,
      `${fmtNum(it.bonifPct ?? 0)}%`,
    ]
    if (esA) row.push(`${fmtNum(it.alicuotaIva, 0)}%`)
    row.push(`${esUsd ? '' : '$ '}${fmtNum(it.subtotal)}`)
    return row
  })

  const colStyles: Record<number, { halign?: 'left' | 'right' | 'center'; cellWidth?: number }> = esA
    ? {
        0: { cellWidth: 72 },
        1: { halign: 'right', cellWidth: 14 },
        2: { halign: 'left', cellWidth: 16 },
        3: { halign: 'right', cellWidth: 24 },
        4: { halign: 'right', cellWidth: 19 },
        5: { halign: 'right', cellWidth: 18 },
        6: { halign: 'right', cellWidth: 27 },
      }
    : {
        0: { cellWidth: 90 },
        1: { halign: 'right', cellWidth: 14 },
        2: { halign: 'left', cellWidth: 16 },
        3: { halign: 'right', cellWidth: 26 },
        4: { halign: 'right', cellWidth: 19 },
        5: { halign: 'right', cellWidth: 25 },
      }

  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    margin: { left: ML, right: MR },
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: { top: 2.5, bottom: 2.5, left: 1.5, right: 1.5 }, textColor: DARK, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: TABLE_HEAD_BG, textColor: BLACK, fontStyle: 'bold', halign: 'center', lineColor: BLACK, lineWidth: 0.3, fontSize: 7 },
    columnStyles: colStyles,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tableEndY: number = (doc as any).lastAutoTable.finalY
  // Borde exterior de la tabla hasta la zona de totales (como el modelo)
  const totBoxH = esUsd ? 50 : 40
  const footZone = PAGE_H - 40 // QR + CAE
  const totY = Math.max(tableEndY + 6, footZone - totBoxH - 4)
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.4)
  doc.line(ML, y, ML, totY)
  doc.line(ML + USABLE_W, y, ML + USABLE_W, totY)

  // ═══ TOTALES ═══
  y = totY
  doc.rect(ML, y, USABLE_W, totBoxH)
  const t = data.totales
  const lblX = ML + USABLE_W - 62
  const valX = ML + USABLE_W - 3
  let ty = y + 6
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...BLACK)
  if (esUsd) {
    doc.text('Moneda: USD - Dólar estadounidense', valX, ty, { align: 'right' })
    doc.setLineWidth(0.2)
    const mw = doc.getTextWidth('Moneda: USD - Dólar estadounidense')
    doc.line(valX - mw, ty + 0.8, valX, ty + 0.8)
    ty += 7
  }
  const totLine = (lbl: string, val: number, bold = true, size = 7.5) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.text(`${lbl}: ${sym}`, lblX, ty, { align: 'right' })
    doc.text(fmtNum(val), valX, ty, { align: 'right' })
    ty += 4.5
  }
  if (esA) {
    totLine('Importe Neto Gravado', t.netoGravado)
    totLine('Importe Exento / No Gravado', t.exento + t.netoNoGravado)
    for (const iva of t.iva) totLine(`IVA ${fmtNum(iva.alicuota, 0)}%`, iva.importe)
    if (t.otrosTributos) totLine('Importe Otros Tributos', t.otrosTributos)
    totLine('Importe Total', t.total, true, 8)
  } else {
    totLine('Subtotal', t.total - t.otrosTributos)
    if (t.otrosTributos) totLine('Importe Otros Tributos', t.otrosTributos)
    totLine('Importe Total', t.total, true, 8)
    // Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)
    const ivaContenido = t.iva.reduce((s, i) => s + i.importe, 0)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.text(`Régimen de Transparencia Fiscal al Consumidor (Ley 27.743) — IVA Contenido: ${sym} ${fmtNum(ivaContenido)} · Otros Impuestos Nacionales Indirectos: ${sym} 0,00`, valX, ty, { align: 'right' })
    ty += 4.5
  }

  // Importe en letras (banda inferior del cuadro)
  const letrasY = y + totBoxH - (esUsd ? 13 : 3.5)
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.3)
  doc.line(ML, letrasY - 4.5, ML + USABLE_W, letrasY - 4.5)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text(`Importe Total: ${importeEnLetras(esUsd ? Math.round(t.total * data.cotizacion * 100) / 100 : t.total)}`, ML + 2, letrasY)

  if (esUsd) {
    const enPesos = Math.round(t.total * data.cotizacion * 100) / 100
    const bandY = letrasY + 2.5
    doc.setFillColor(235, 235, 235)
    doc.rect(ML, bandY, USABLE_W, 10, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    const leyenda = doc.splitTextToSize(
      `El total de este comprobante expresado en moneda de curso legal - Pesos Argentinos - considerándose un tipo de cambio consignado de ${fmtNum(data.cotizacion, 5)} asciende a : $`,
      USABLE_W - 40
    )
    doc.text(leyenda, ML + USABLE_W / 2 - 18, bandY + 4, { align: 'center' })
    doc.setFontSize(8)
    doc.text(fmtNum(enPesos), valX, bandY + 6, { align: 'right' })
  }
  y += totBoxH + 3

  // Comprobantes asociados (NC/ND) y observaciones
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...DARK)
  if (data.asociados?.length) {
    doc.text(`Comprobantes asociados: ${data.asociados.map((a) => a.descripcion).join(', ')}`, ML + 2, y)
    y += 4
  }
  if (data.observaciones) {
    const lines = doc.splitTextToSize(`Observaciones: ${data.observaciones}`, USABLE_W - 4)
    doc.text(lines, ML + 2, y)
    y += lines.length * 3.5
  }
  // Leyenda A → Monotributo (RG 5003)
  if (esA && /monotrib/i.test(data.receptor.condicionIva)) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(6.5)
    const leyenda = doc.splitTextToSize(
      'El crédito fiscal discriminado en el presente comprobante, sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley N° 27.618',
      USABLE_W - 4
    )
    doc.text(leyenda, ML + 2, y)
  }

  // ═══ PIE: QR + CAE ═══
  const qrY = PAGE_H - 36
  if (qrBase64) {
    try {
      doc.addImage(qrBase64, 'PNG', ML, qrY, 24, 24)
    } catch {
      /* sin QR */
    }
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...DARK)
  doc.text('Pagina 1', ML, qrY + 28)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...BLACK)
  doc.text('CAE Nro:', ML + USABLE_W - 52, qrY + 4, { align: 'right' })
  doc.text('Fecha de Vto. de CAE:', ML + USABLE_W - 52, qrY + 9, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.text(data.cae, ML + USABLE_W - 50, qrY + 4)
  doc.text(fmtDate(data.caeVencimiento), ML + USABLE_W - 50, qrY + 9)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(...GRAY)
  doc.text('Comprobante Autorizado', ML + USABLE_W - 52, qrY + 14, { align: 'right' })

  if (data.isVoided) {
    doc.saveGraphicsState()
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(60)
    doc.setTextColor(220, 0, 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc.setGState(new (doc as any).GState({ opacity: 0.25 }))
    doc.text('ANULADA', PAGE_W / 2, 150, { align: 'center', angle: 35 })
    doc.restoreGraphicsState()
  }
}

// ── API pública ───────────────────────────────────────────────────────────────
export async function generateFacturaPDF(data: FacturaPDFData): Promise<Buffer> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const [logoBase64, qrBase64] = await Promise.all([
    getLogo().catch(() => ''),
    data.qrUrl ? QRCode.toDataURL(data.qrUrl, { margin: 0, width: 240, errorCorrectionLevel: 'M' }).catch(() => '') : Promise.resolve(''),
  ])
  drawFactura(doc, data, logoBase64, qrBase64)
  return Buffer.from(doc.output('arraybuffer'))
}

/** Nombre de archivo: "Factura A 0007-00000001 RAZON SOCIAL.pdf" (mismo criterio que el archivo de facturas emitidas). */
export function facturaPdfFilename(d: Pick<FacturaPDFData, 'clase' | 'letra' | 'puntoVenta' | 'numero' | 'receptor'>): string {
  const clase = d.clase === 'FACTURA' ? 'Factura' : d.clase === 'NOTA DE CRÉDITO' ? 'Nota de Credito' : 'Nota de Debito'
  const nombre = d.receptor.nombre.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
  return `${clase} ${d.letra} ${nroFormateado(d.puntoVenta, d.numero)}${nombre ? ` ${nombre}` : ''}.pdf`
}

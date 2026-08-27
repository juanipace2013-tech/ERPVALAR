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
  /** FCE MiPyME (cbteTipo 201/206): vencimiento de pago y CBU del emisor */
  fce?: { vtoPago?: Date | null; cbu?: string | null }
  /** Orden de compra del cliente (Quote.purchaseOrderNumber) */
  ordenCompra?: string | null
  /** Número de cliente (id en Colppy) */
  clienteNro?: string | null
  /** Número de remito asociado */
  remito?: string | null
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

/** Título del comprobante; los FCE MiPyME (201-208) llevan su denominación RG 4367. */
function tituloComprobante(data: Pick<FacturaPDFData, 'clase' | 'cbteTipo'>): string {
  if (data.cbteTipo >= 201 && data.cbteTipo <= 208) {
    if (data.clase === 'FACTURA') return 'Factura de Crédito MiPyME'
    if (data.clase === 'NOTA DE CRÉDITO') return 'Nota de Crédito MiPyME'
    return 'Nota de Débito MiPyME'
  }
  return claseTitulo(data.clase)
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

  // ── Geometría de página ──
  const hy = 16.5
  const hh = 44
  const midX = PAGE_W / 2
  const ry = hy + hh + 2
  const rh = 24
  const gy = ry + rh + 1.5
  const rowH = 8
  const gy2 = gy + rowH
  const itemsStartY = gy2 + rowH + 1.5
  const totBoxH = 40
  const obsH = 10
  const footTopY = PAGE_H - 36 // arranque del pie QR/CAE
  const obsY = footTopY - obsH - 6
  const totY = obsY - totBoxH - 2 // totales SIEMPRE anclados abajo (como el modelo)
  // Páginas intermedias: los ítems usan toda la hoja; abajo va la banda
  // "Subtotal" y la página siguiente arranca con "TRANSPORTE" (ese acumulado).
  const subBandH = 8
  const subBandY = footTopY - 12
  const transpH = 7

  // ═══ ENCABEZADO COMPLETO (se repite en cada página) ═══
  const drawEncabezado = () => {
    // Banda "ORIGINAL"
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(0.5)
    doc.rect(ML, 8, USABLE_W, 6.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...BLACK)
    doc.text('ORIGINAL', PAGE_W / 2, 12.6, { align: 'center' })

    // Cabecera
    doc.rect(ML, hy, USABLE_W, hh)
    doc.line(midX, hy, midX, hy + hh)
    if (logoBase64) {
      try {
        doc.addImage(logoBase64, 'PNG', ML + 26, hy + 2.5, 40, 12, undefined, 'SLOW')
      } catch {
        /* sin logo */
      }
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(EMISOR.razonSocial, ML + 3, hy + 22)
    doc.setFontSize(8.5)
    doc.text(EMISOR.domicilio, ML + 3, hy + 28)
    doc.text('República Argentina', ML + 3, hy + 33)
    doc.text('Tel.: +54 11 4551-3343 | 4552-2874', ML + 3, hy + 38)
    doc.text('IVA RESPONSABLE INSCRIPTO', ML + 3, hy + 42.5)

    // Recuadro de letra sobre el separador
    const boxW = 16
    const boxH = 13
    doc.setFillColor(255, 255, 255)
    doc.rect(midX - boxW / 2, hy, boxW, boxH, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.text(data.letra, midX, hy + 8.5, { align: 'center' })
    doc.setFontSize(6.5)
    doc.text(`COD.${CODIGO_CBTE[data.cbteTipo] ?? String(data.cbteTipo)}`, midX, hy + 12, { align: 'center' })

    // Derecha: número + título + fecha + datos fiscales
    const rx = midX + 8
    const titulo = tituloComprobante(data)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(`N°:  ${String(data.puntoVenta).padStart(4, '0')}  -  ${String(data.numero).padStart(8, '0')}`, rx, hy + 8)
    doc.setFontSize(titulo.length > 16 ? 11 : 13)
    doc.text(titulo.toUpperCase(), rx, hy + 15)
    doc.setFontSize(9)
    doc.text(`FECHA: ${fmtDate(data.fecha)}`, rx, hy + 22)
    label('CUIT:', fmtCuit(EMISOR.cuit.replace(/\D/g, '')), rx, hy + 29, ML + USABLE_W - 2, 8)
    label('Ingresos Brutos Conv. Multi:', EMISOR.iibb, rx, hy + 34, ML + USABLE_W - 2, 8)
    label('Fecha de Inicio de actividades:', EMISOR.inicioActividades, rx, hy + 39, ML + USABLE_W - 2, 8)

    // Receptor
    doc.rect(ML, ry, USABLE_W, rh)
    const r = data.receptor
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text('Señores', ML + 3, ry + 6)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(r.nombre.slice(0, 70), ML + 24, ry + 6)
    label('Cliente Nro:', data.clienteNro || '-', ML + 138, ry + 6, ML + USABLE_W - 2, 8.5)
    {
      const lines: string[] = doc.splitTextToSize(r.domicilio || '-', 108)
      if (lines.length > 2) {
        lines.length = 2
        lines[1] = lines[1].replace(/.{2}$/, '…')
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.text(lines, ML + 24, ry + 11.5)
    }
    label('IVA:', r.condicionIva.toUpperCase(), ML + 3, ry + 21, ML + 110, 8.5)
    {
      const docLabel = r.docTipoLabel ? `${r.docTipoLabel}:` : 'Doc:'
      const docVal = r.docTipoLabel === 'CUIT' ? fmtCuit(r.docNro) : r.docNro || '-'
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.text(`${docLabel} ${docVal}`, ML + USABLE_W - 3, ry + 21, { align: 'right' })
    }

    // Filas OC / condiciones
    doc.rect(ML, gy, USABLE_W, rowH)
    doc.line(ML + USABLE_W * 0.55, gy, ML + USABLE_W * 0.55, gy + rowH)
    label('Orden de Compra N°:', data.ordenCompra || '-', ML + 3, gy + 5.3, ML + USABLE_W * 0.55 - 2, 8.5)
    label('Referencia:', data.referencia || '-', ML + USABLE_W * 0.55 + 3, gy + 5.3, ML + USABLE_W - 2, 8.5)

    doc.rect(ML, gy2, USABLE_W, rowH)
    doc.line(ML + USABLE_W * 0.48, gy2, ML + USABLE_W * 0.48, gy2 + rowH)
    doc.line(ML + USABLE_W * 0.73, gy2, ML + USABLE_W * 0.73, gy2 + rowH)
    label('Condiciones de Pago:', data.condicionVenta, ML + 3, gy2 + 5.3, ML + USABLE_W * 0.48 - 2, 8.5)
    label('Vencimiento:', fmtDate(data.fechaVencimiento ?? data.fecha), ML + USABLE_W * 0.48 + 3, gy2 + 5.3, ML + USABLE_W * 0.73 - 2, 8.5)
    label('Remito N°:', data.remito || '-', ML + USABLE_W * 0.73 + 3, gy2 + 5.3, ML + USABLE_W - 2, 8.5)
  }

  drawEncabezado()

  // ═══ ITEMS (pagina solo; el encabezado se redibuja en cada página nueva) ═══
  const head = [['Cantidad', 'Código/Descripción', '', `Precio Unit.${esUsd ? ' (USD)' : ''}`, 'Total', 'Dto', 'Precio Total']]
  const body = data.items.map((it) => {
    const desc = `${it.codigo ? `${it.codigo} - ` : ''}${it.descripcion}${it.detalle ? `\n${it.detalle}` : ''}`
    const bonif = it.bonifPct ?? 0
    const totalPre = it.cantidad * it.precioUnitario
    return [
      fmtNum(it.cantidad, 2),
      desc,
      esA ? `( ${fmtNum(it.alicuotaIva, 2)} )` : '',
      fmtNum(it.precioUnitario),
      fmtNum(totalPre),
      fmtNum(bonif),
      fmtNum(it.subtotal),
    ]
  })
  // Acumulado por página para la banda Subtotal / fila TRANSPORTE
  const lastRowByPage = new Map<number, number>()
  autoTable(doc, {
    startY: itemsStartY,
    head,
    body,
    // top: en páginas de continuación deja la franja para "TRANSPORTE";
    // bottom: reserva pie + banda "Subtotal" (los ítems usan toda la hoja)
    margin: { left: ML, right: MR, top: itemsStartY + transpH, bottom: PAGE_H - subBandY + 1 },
    theme: 'plain',
    rowPageBreak: 'avoid',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: { top: 2, bottom: 2, left: 1.5, right: 1.5 }, textColor: DARK, valign: 'top', overflow: 'linebreak' },
    headStyles: { fillColor: TABLE_HEAD_BG, textColor: BLACK, fontStyle: 'bold', halign: 'center', lineColor: BLACK, lineWidth: 0.3, fontSize: 7.5 },
    columnStyles: {
      0: { halign: 'right', cellWidth: 15 },
      1: { cellWidth: 77 },
      2: { halign: 'center', cellWidth: 15 },
      3: { halign: 'right', cellWidth: 24 },
      4: { halign: 'right', cellWidth: 25 },
      5: { halign: 'right', cellWidth: 11 },
      6: { halign: 'right', cellWidth: 23 },
    },
    didDrawPage: (d) => {
      if (d.pageNumber > 1) drawEncabezado()
    },
    didDrawCell: (d) => {
      if (d.section === 'body' && typeof d.row.index === 'number') {
        const prev = lastRowByPage.get(d.pageNumber) ?? -1
        lastRowByPage.set(d.pageNumber, Math.max(prev, d.row.index))
      }
    },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tableEndY: number = (doc as any).lastAutoTable.finalY

  // Si los ítems terminan encima de la zona de totales, los totales van en página nueva
  if (tableEndY + 4 > totY) {
    doc.addPage()
    drawEncabezado()
  }

  // ═══ TOTALES (solo última página, anclados abajo) ═══
  let y = totY
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.4)
  doc.rect(ML, y, USABLE_W, totBoxH)
  const t = data.totales
  const lblX = ML + USABLE_W - 42
  const valX = ML + USABLE_W - 3

  // Izquierda: importe en letras + Régimen de Transparencia Fiscal
  const letras = `${importeEnLetras(esUsd ? Math.round(t.total * data.cotizacion * 100) / 100 : t.total).toUpperCase()} ---`
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.8)
  {
    const lines: string[] = doc.splitTextToSize(letras, 112)
    doc.text(lines.slice(0, 2), ML + 4, y + 5.5)
  }
  const bandY = y + 12
  doc.setFillColor(200, 200, 200)
  doc.setLineWidth(0.3)
  doc.rect(ML + 4, bandY, 112, 6, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)', ML + 4 + 56, bandY + 4, { align: 'center' })
  const ivaContenido = t.iva.reduce((s, i) => s + i.importe, 0)
  doc.rect(ML + 4, bandY + 6, 112, 5.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text('IVA Contenido', ML + 78, bandY + 10, { align: 'right' })
  doc.text(fmtNum(ivaContenido), ML + 114, bandY + 10, { align: 'right' })

  // Derecha: totales
  let ty = y + 6
  const totLine = (lbl: string, val: number | null, bold = false, size = 8.5) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(size)
    doc.text(`${lbl}: ${sym}`, lblX, ty, { align: 'right' })
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    if (val !== null) doc.text(fmtNum(val), valX, ty, { align: 'right' })
    ty += 5
  }
  if (esA) {
    totLine('Subtotal', t.netoGravado)
    for (const iva of t.iva) totLine(`IVA ${fmtNum(iva.alicuota, 1)}%`, iva.importe)
    totLine('IVA Exento', t.exento + t.netoNoGravado)
    totLine('Otros Tributos', t.otrosTributos)
    ty += 1.5
    totLine('Importe Total', t.total, true, 9.5)
  } else {
    totLine('Subtotal', t.total - t.otrosTributos)
    totLine('Otros Tributos', t.otrosTributos)
    ty += 1.5
    totLine('Importe Total', t.total, true, 9.5)
  }

  // ═══ OBSERVACIONES (última página) ═══
  const obsParts: string[] = []
  if (esUsd) {
    const enPesos = Math.round(t.total * data.cotizacion * 100) / 100
    obsParts.push(`Importe expresado en Dólares Estadounidenses, equivalente a Pesos ${fmtNum(enPesos)} al Tipo de Cambio ${fmtNum(data.cotizacion, 2)} ---`)
  }
  if (data.fce?.cbu || data.fce?.vtoPago) {
    obsParts.push(`FCE MiPyME${data.fce.vtoPago ? ` - Vto. de pago: ${fmtDate(data.fce.vtoPago)}` : ''}${data.fce.cbu ? ` - CBU emisor: ${data.fce.cbu}` : ''}`)
  }
  if (data.asociados?.length) obsParts.push(`Comprobantes asociados: ${data.asociados.map((a) => a.descripcion).join(', ')}`)
  if (data.observaciones) obsParts.push(data.observaciones)
  if (esA && /monotrib/i.test(data.receptor.condicionIva)) {
    obsParts.push('El crédito fiscal discriminado en el presente comprobante sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley N° 27.618')
  }
  doc.setLineWidth(0.4)
  doc.rect(ML, obsY, USABLE_W, obsH)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...DARK)
  {
    const txt = `Observaciones: ${obsParts.length ? obsParts.join(' · ') : '---'}`
    const lines: string[] = doc.splitTextToSize(txt, USABLE_W - 8)
    doc.text(lines.slice(0, 3), ML + 4, obsY + 4)
  }

  // ═══ POR PÁGINA: bordes del cuerpo, pie QR/CAE y numeración ═══
  // Acumulado de la columna Precio Total al final de cada página
  const cumHasta = (rowIdx: number) => data.items.slice(0, rowIdx + 1).reduce((s, it) => s + it.subtotal, 0)
  const sumTotalItems = cumHasta(data.items.length - 1)
  const cumDePagina = (p: number) => {
    const last = lastRowByPage.get(p)
    return last === undefined ? sumTotalItems : cumHasta(last)
  }

  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    const esUltima = p === pages
    // Bordes laterales del cuerpo de ítems
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(0.4)
    const bottom = esUltima ? totY : subBandY
    doc.line(ML, itemsStartY, ML, bottom)
    doc.line(ML + USABLE_W, itemsStartY, ML + USABLE_W, bottom)

    // Página de continuación: fila TRANSPORTE con el acumulado que viene
    if (p > 1) {
      doc.setLineWidth(0.3)
      doc.rect(ML, itemsStartY, USABLE_W, transpH)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...BLACK)
      doc.text('TRANSPORTE', ML + USABLE_W - 30, itemsStartY + 4.8, { align: 'right' })
      doc.text(fmtNum(cumDePagina(p - 1)), ML + USABLE_W - 3, itemsStartY + 4.8, { align: 'right' })
    }

    // Página intermedia: banda Subtotal con el acumulado hasta acá
    if (!esUltima) {
      doc.setLineWidth(0.4)
      doc.rect(ML, subBandY, USABLE_W, subBandH)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...BLACK)
      doc.text('Subtotal', ML + USABLE_W - 60, subBandY + 5.3, { align: 'right' })
      doc.text(sym, ML + USABLE_W - 40, subBandY + 5.3)
      doc.text(fmtNum(cumDePagina(p)), ML + USABLE_W - 3, subBandY + 5.3, { align: 'right' })
    }

    // Página x de y
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...DARK)
    doc.text(`Página  ${p}  de  ${pages}`, PAGE_W / 2, obsY + obsH + 4, { align: 'center' })

    // Pie QR + CAE
    const fy = footTopY
    if (qrBase64) {
      try {
        doc.addImage(qrBase64, 'PNG', ML, fy, 26, 26)
      } catch {
        /* sin QR */
      }
    }
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8.5)
    doc.setTextColor(...BLACK)
    doc.text('Visite nuestra página web www.val-ar.com.ar', ML + 30, fy + 8)
    doc.setFont('helvetica', 'bolditalic')
    doc.setFontSize(9.5)
    doc.text('Comprobante Autorizado', ML + 30, fy + 17)
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(6)
    doc.setTextColor(...GRAY)
    doc.text('Esta administración Federal no se responsabiliza por los datos ingresados en el detalle de la operación', ML + 30, fy + 22)

    doc.setTextColor(...BLACK)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('CAE N°:', ML + USABLE_W - 42, fy + 8, { align: 'right' })
    doc.text('Fecha de Vto. de CAE:', ML + USABLE_W - 42, fy + 15, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.text(data.cae, ML + USABLE_W - 2, fy + 8, { align: 'right' })
    doc.text(fmtDate(data.caeVencimiento), ML + USABLE_W - 2, fy + 15, { align: 'right' })

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

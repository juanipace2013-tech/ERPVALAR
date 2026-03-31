import { jsPDF } from 'jspdf'
import { LOGO_BASE64 } from '@/lib/logo-base64'

export interface ShippingLabelData {
  deliveryNumber: string
  date: Date
  customer: {
    name: string
    businessName?: string | null
    cuit: string
    phone?: string | null
    mobile?: string | null
    address?: string | null
    city?: string | null
    province?: string | null
  }
  deliveryAddress?: string | null
  deliveryCity?: string | null
  deliveryProvince?: string | null
  deliveryPostalCode?: string | null
  deliveryContactName?: string | null
  deliveryContactPhone?: string | null
  carrier?: string | null
  transportAddress?: string | null
  purchaseOrder?: string | null
  bultos?: string | null
}

export function generateShippingLabels(data: ShippingLabelData): Blob {
  const bultosCount = parseBultosCount(data.bultos)
  const bultosText = data.bultos || '1'

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  for (let i = 1; i <= bultosCount; i++) {
    if (i > 1) doc.addPage()
    drawLabel(doc, data, i, bultosCount, bultosText)
  }

  return doc.output('blob')
}

function parseBultosCount(bultos?: string | null): number {
  if (!bultos) return 1
  const match = bultos.match(/^(\d+)/)
  if (match) return parseInt(match[1], 10)
  return 1
}

function drawLabel(
  doc: jsPDF,
  data: ShippingLabelData,
  bultoNumber: number,
  totalBultos: number,
  bultosText: string
) {
  const pageWidth = 210
  const margin = 15
  const contentWidth = pageWidth - 2 * margin
  let y = margin

  // Borde exterior
  doc.setDrawColor(0)
  doc.setLineWidth(0.8)
  doc.rect(margin - 2, margin - 2, contentWidth + 4, 262)

  // Logo VAL ARG
  try {
    doc.addImage(LOGO_BASE64, 'PNG', margin + 2, y, 40, 12)
  } catch {
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('VAL ARG S.R.L.', margin + 2, y + 8)
  }

  // Título
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('RÓTULO DE ENVÍO', pageWidth / 2, y + 7, { align: 'center' })

  // Remito y fecha arriba a la derecha
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`Remito: ${data.deliveryNumber}`, pageWidth - margin - 2, y + 4, { align: 'right' })
  doc.text(
    `Fecha: ${data.date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`,
    pageWidth - margin - 2, y + 9, { align: 'right' }
  )

  y += 18

  // Línea separadora
  doc.setLineWidth(0.5)
  doc.line(margin, y, pageWidth - margin, y)
  y += 6

  // DESTINATARIO
  const recipientName = data.customer.businessName || data.customer.name
  drawField(doc, 'DESTINATARIO', recipientName, margin, y, contentWidth, 16, true)
  y += 22

  // CUIT
  drawField(doc, 'CUIT', data.customer.cuit, margin, y, contentWidth, 12)
  y += 16

  // DESTINO
  const address = buildAddress(data)
  drawField(doc, 'DESTINO', address, margin, y, contentWidth, 12, false, true)
  const addressLines = doc.splitTextToSize(address, contentWidth - 6)
  y += 8 + (addressLines.length * 5) + 6

  // CONTACTO — solo de DeliveryAddress, nunca del cliente Colppy
  const contactParts: string[] = []
  if (data.deliveryContactName) contactParts.push(data.deliveryContactName)
  if (data.deliveryContactPhone) contactParts.push(data.deliveryContactPhone)
  const contactInfo = contactParts.join(' - ')
  if (contactInfo) {
    drawField(doc, 'CONTACTO', contactInfo, margin, y, contentWidth, 11)
    y += 14
  }

  // ORDEN DE COMPRA
  if (data.purchaseOrder) {
    drawField(doc, 'O/C REF.', data.purchaseOrder, margin, y, contentWidth, 12)
    y += 16
  }

  // TRANSPORTE
  const transport = buildTransport(data)
  if (transport) {
    drawField(doc, 'TRANSPORTE', transport, margin, y, contentWidth, 12, false, true)
    const transportLines = doc.splitTextToSize(transport, contentWidth - 6)
    y += 8 + (transportLines.length * 5) + 6
  }

  // BULTOS (destacado con recuadro)
  y += 4
  doc.setFillColor(240, 240, 240)
  doc.rect(margin, y - 2, contentWidth, 22, 'F')
  doc.setDrawColor(0)
  doc.setLineWidth(0.5)
  doc.rect(margin, y - 2, contentWidth, 22, 'S')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('BULTO:', margin + 4, y + 7)

  doc.setFontSize(22)
  doc.text(`${bultoNumber} / ${totalBultos}`, margin + 30, y + 14)

  if (bultosText && !/^\d+$/.test(bultosText)) {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`(${bultosText})`, margin + 70, y + 14)
  }

  y += 28

  // Línea separadora
  doc.setLineWidth(0.3)
  doc.line(margin, y, pageWidth - margin, y)
  y += 6

  // REMITENTE
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('REMITENTE:', margin + 2, y)
  y += 5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const remitente = [
    'VAL ARG S.R.L. — CUIT: 30-71537357-9',
    '14 de Julio 175 — Paternal — CABA',
    'Tel: 011-4551-3343 — ventas@val-ar.com.ar',
  ]
  remitente.forEach(line => {
    doc.text(line, margin + 2, y)
    y += 4.5
  })
}

function drawField(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize: number,
  isBig = false,
  isMultiline = false
) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(80, 80, 80)
  doc.text(`${label}:`, x + 2, y)

  doc.setFont('helvetica', isBig ? 'bold' : 'normal')
  doc.setFontSize(fontSize)
  doc.setTextColor(0, 0, 0)

  if (isMultiline) {
    const lines = doc.splitTextToSize(value, maxWidth - 6)
    doc.text(lines, x + 2, y + 6)
  } else {
    doc.text(value, x + 2, y + 6)
  }
}

function buildAddress(data: ShippingLabelData): string {
  const addr = data.deliveryAddress || data.customer.address || ''
  const city = data.deliveryCity || data.customer.city || ''
  const province = data.deliveryProvince || data.customer.province || ''
  const cp = data.deliveryPostalCode || ''

  const parts = [addr, city, province ? `Pcia. de ${province}` : '', cp ? `CP ${cp}` : '']
    .filter(Boolean)
  return parts.join(', ') || 'Sin dirección'
}

function buildTransport(data: ShippingLabelData): string {
  if (!data.carrier) return ''
  let t = data.carrier
  if (data.transportAddress) t += ` (${data.transportAddress})`
  return t
}

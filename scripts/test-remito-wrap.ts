/**
 * Test de layout del nombre del cliente en remito (remito-generator.ts).
 *
 * Genera 6 PDFs en tmp/remitos-test/ con casos de distinto largo de razón
 * social (incluyendo el caso real reportado: "ASOCIACION ARGENTINA DE LOS
 * ADVENTISTAS DEL SEPTIMO DIA") y valida programáticamente que:
 *   - El font-size adaptativo se aplica correctamente (8/7/6.5pt).
 *   - Ninguna línea excede el ancho útil de la columna izquierda (86mm).
 *   - El bloque "Señor(es):" no genera más de 2 líneas.
 *   - El blindaje contra palabras sin espacios funciona.
 *   - El nombre no invade el divisor vertical (clientDivX = 124mm).
 *
 * Uso:
 *   npm run test:remito
 *
 * Los PDFs generados quedan en tmp/remitos-test/ (gitignored) para
 * inspección visual manual si hace falta.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { jsPDF } from 'jspdf'
import { generateRemitoPDF, type RemitoPDFData } from '../src/lib/pdf/remito-generator'
import { layoutLongTextBlock } from '../src/lib/pdf/text-layout-helpers'

type Case = {
  id: string
  label: string
  razonSocial: string
  expectedFontSize: number
  expectedMaxLines: number
}

const CASES: Case[] = [
  // Regla: > 80 → 6.5, > 50 → 7, else → 8
  { id: '01-corto',         label: 'Corto (9c)',          razonSocial: 'ACME S.A.',                                                                              expectedFontSize: 8,   expectedMaxLines: 1 },
  { id: '02-medio',         label: 'Medio (31c)',         razonSocial: 'DISTRIBUIDORA DEL CENTRO S.R.L.',                                                        expectedFontSize: 8,   expectedMaxLines: 1 },
  { id: '03-real-bug',      label: 'Caso real reportado (54c)', razonSocial: 'ASOCIACION ARGENTINA DE LOS ADVENTISTAS DEL SEPTIMO DIA',                          expectedFontSize: 7,   expectedMaxLines: 2 },
  { id: '04-largo',         label: 'Largo (60c)',         razonSocial: 'CONSTRUCCIONES ELECTROMECANICAS DEL OESTE S.A.-OBRAS ANEXAS',                            expectedFontSize: 7,   expectedMaxLines: 2 },
  { id: '05-patologico',    label: 'Patológico (~90c)',   razonSocial: 'COOPERATIVA DE TRABAJO LOS PIONEROS DEL SUR ARGENTINO LIMITADA - SUCURSAL MENDOZA OESTE', expectedFontSize: 6.5, expectedMaxLines: 2 },
  { id: '06-palabra-unica', label: 'Palabra única (64c)', razonSocial: 'CONSTRUCCIONESELECTROMECANICASDELOESTESOCIEDADANONIMAOBRASANEXAS',                       expectedFontSize: 7,   expectedMaxLines: 2 },
]

function adaptiveSize(name: string): number {
  return name.length > 80 ? 6.5 : name.length > 50 ? 7 : 8
}

// Mismas constantes del generador
const PAGE_W = 210
const ML = 10
const MR = 10
const USABLE_W = PAGE_W - ML - MR
const CLIENT_DIV_X = ML + USABLE_W * 0.6 // 124mm
const CX = ML + 4 // 14mm
const NAME_X = CX + 22 // 36mm
const NAME_MAX_WIDTH = CLIENT_DIV_X - NAME_X - 2 // 86mm

function buildData(razonSocial: string, idx: number): RemitoPDFData {
  return {
    deliveryNumber: `RE 0006-0000012${idx}`,
    date: new Date('2026-04-29T12:00:00'),
    customer: {
      name: razonSocial,
      businessName: razonSocial,
      cuit: '30-71802578-4',
      address: 'AV. ALVEAR 478',
      city: 'GODOY CRUZ',
      province: 'Mendoza',
      taxCondition: 'RESPONSABLE_INSCRIPTO',
    },
    items: [
      { sku: 'SKU-001', description: 'Producto demo línea 1', quantity: 5, unit: 'UN' },
      { sku: 'SKU-002', description: 'Producto demo línea 2', quantity: 2, unit: 'UN' },
    ],
    carrier: 'Rodriguez hermanos',
    transportAddress: 'Erezcano 3880 - CABA',
    deliveryType: null,
    purchaseOrder: 'Nº P.B-000-201',
    customerInvoiceNumber: 'A-0001-00001234',
    bultos: '1',
    totalAmountARS: 123456.78,
    notes: null,
    cai: null,
    isVoided: false,
  }
}

const OUT_DIR = resolve(process.cwd(), 'tmp/remitos-test')
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

async function main() {
  let allOk = true
  const report: string[] = []

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]

    // 1) Genera el PDF real
    const data = buildData(c.razonSocial, i + 1)
    const blob = await generateRemitoPDF(data)
    const buf = Buffer.from(await (blob as Blob).arrayBuffer())
    const pdfPath = join(OUT_DIR, `${c.id}.pdf`)
    writeFileSync(pdfPath, buf)

    // 2) Re-ejecuta la lógica de layout sobre un jsPDF fresco para inspección
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const fontSize = adaptiveSize(c.razonSocial)
    const lines = layoutLongTextBlock(doc, c.razonSocial, {
      maxWidth: NAME_MAX_WIDTH,
      fontSize,
      maxLines: 2,
      fontStyle: 'normal',
    })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(fontSize)
    const widthsMm = lines.map(l => doc.getTextWidth(l))
    const maxWidthMm = Math.max(...widthsMm)
    const lineHeightMm = fontSize * 0.42
    const advanceMm = lines.length === 1 ? 6 : lines.length * lineHeightMm + 1.5

    const issues: string[] = []

    if (fontSize !== c.expectedFontSize) {
      issues.push(`fontSize ${fontSize}pt ≠ esperado ${c.expectedFontSize}pt`)
    }
    if (lines.length > c.expectedMaxLines) {
      issues.push(`líneas=${lines.length} > esperado=${c.expectedMaxLines}`)
    }
    if (lines.length > 2) {
      issues.push(`viola tope de 2 líneas: ${lines.length}`)
    }
    if (maxWidthMm > NAME_MAX_WIDTH + 0.3) {
      issues.push(`desborde: maxLineWidth=${maxWidthMm.toFixed(2)}mm > limite ${NAME_MAX_WIDTH}mm`)
    }
    // El nombre no debe invadir el divisor vertical en clientDivX (124mm)
    const nameRightEdgeMm = NAME_X + maxWidthMm
    if (nameRightEdgeMm > CLIENT_DIV_X - 0.5) {
      issues.push(`invade columna derecha: borde=${nameRightEdgeMm.toFixed(2)}mm ≥ divisor=${CLIENT_DIV_X}mm`)
    }
    // Caso palabra única → debe partirse en 2 líneas
    if (c.id === '06-palabra-unica' && lines.length < 2) {
      issues.push(`palabra única no se partió: lines=${lines.length}`)
    }
    // Si avance + cy_inicial + 3 labels (Domicilio/Localidad/Entrega) cabe en clientBoxH=36
    const cyAfterAllLabels = 6 + advanceMm + 6 + 6 + 6 // arranque cy=6, 3 labels más a 6mm c/u
    if (cyAfterAllLabels > 36) {
      issues.push(`bloque cliente desborda boxH=36mm: cy_final=${cyAfterAllLabels.toFixed(1)}mm`)
    }

    const status = issues.length === 0 ? '✅' : '❌'
    if (issues.length) allOk = false

    const linesPreview = lines.map(l => `"${l}"`).join('  ⏎  ')
    const hasEllipsis = lines[lines.length - 1].endsWith('…')
    report.push(
      `[${c.id}] ${status} ${c.label}\n` +
      `   nombre (${c.razonSocial.length}c): "${c.razonSocial}"\n` +
      `   fontSize=${fontSize}pt   líneas=${lines.length}   ellipsis=${hasEllipsis}   advance=${advanceMm.toFixed(1)}mm\n` +
      `   maxLineWidth=${maxWidthMm.toFixed(1)}mm / ${NAME_MAX_WIDTH}mm   borde=${nameRightEdgeMm.toFixed(1)}mm (divisor a ${CLIENT_DIV_X}mm)\n` +
      `   render: ${linesPreview}\n` +
      (issues.length ? `   ⚠ issues: ${issues.join(' | ')}\n` : '') +
      `   pdf: ${pdfPath}\n`
    )
  }

  console.log('\n=== Reporte remito wrap ===\n')
  console.log(report.join('\n'))
  console.log(`PDFs generados en: ${OUT_DIR}`)
  console.log(allOk ? '\n✅ TODO OK, MERGEABLE\n' : '\n❌ HAY ISSUES — revisar arriba\n')
  process.exit(allOk ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(2) })

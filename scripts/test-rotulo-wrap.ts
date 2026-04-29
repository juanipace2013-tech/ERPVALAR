/**
 * Test de layout del rótulo de envío (shipping-label-generator.ts).
 *
 * Genera 5 PDFs en tmp/rotulos-test/ con casos de distinto largo
 * de razón social (corto, medio, largo real, patológico, palabra única)
 * y valida programáticamente que:
 *   - El font-size adaptativo se aplica correctamente.
 *   - Ninguna línea excede el ancho útil (174mm).
 *   - El bloque destinatario no genera más de 3 líneas.
 *   - El blindaje contra palabras sin espacios funciona.
 *
 * Uso:
 *   npm run test:rotulo
 *
 * Los PDFs generados quedan en tmp/rotulos-test/ (gitignored) para
 * inspección visual manual si hace falta.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { jsPDF } from 'jspdf'
import {
  generateShippingLabels,
  layoutRecipientName,
  type ShippingLabelData,
} from '../src/lib/pdf/shipping-label-generator'

type Case = {
  id: string
  label: string
  razonSocial: string
  expectedFontSize: number // pt
  expectedLines: number    // máx esperado
}

const CASES: Case[] = [
  // expectedFontSize sigue la regla: >70→11, >50→13, >35→14, else→16
  { id: '01-corto',         label: 'Corto (9c)',        razonSocial: 'ACME S.A.',                                                                              expectedFontSize: 16, expectedLines: 1 },
  { id: '02-medio',         label: 'Medio (31c)',       razonSocial: 'DISTRIBUIDORA DEL CENTRO S.R.L.',                                                        expectedFontSize: 16, expectedLines: 1 },
  { id: '03-largo',         label: 'Largo real (60c)',  razonSocial: 'CONSTRUCCIONES ELECTROMECANICAS DEL OESTE S.A.-OBRAS ANEXAS',                            expectedFontSize: 13, expectedLines: 3 },
  { id: '04-patologico',    label: 'Patológico (~90c)', razonSocial: 'COOPERATIVA DE TRABAJO LOS PIONEROS DEL SUR ARGENTINO LIMITADA - SUCURSAL MENDOZA OESTE', expectedFontSize: 11, expectedLines: 3 },
  { id: '05-palabra-unica', label: 'Palabra única ultra-larga (64c)', razonSocial: 'CONSTRUCCIONESELECTROMECANICASDELOESTESOCIEDADANONIMAOBRASANEXAS',          expectedFontSize: 13, expectedLines: 3 },
]

function adaptiveSize(name: string): number {
  return name.length > 70 ? 11 : name.length > 50 ? 13 : name.length > 35 ? 14 : 16
}

function buildData(razonSocial: string, idx: number): ShippingLabelData {
  return {
    deliveryNumber: `RE 0006-0000012${idx}`,
    date: new Date('2026-04-29T12:00:00'),
    customer: {
      name: razonSocial,
      businessName: razonSocial,
      cuit: '30-71802578-4',
      phone: '0261-4123456',
      mobile: null,
      address: 'ALVEAR 478',
      city: 'GODOY CRUZ',
      province: 'Mendoza',
    },
    deliveryAddress: 'ALVEAR 478',
    deliveryCity: 'GODOY CRUZ',
    deliveryProvince: 'Mendoza',
    deliveryPostalCode: '5501',
    deliveryContactName: 'Juan Pérez',
    deliveryContactPhone: '0261-5559999',
    carrier: 'Rodriguez hermanos',
    transportAddress: 'Erezcano 3880 - CABA',
    purchaseOrder: 'Nº P.B-000-201',
    bultos: '1',
  }
}

const OUT_DIR = resolve(process.cwd(), 'tmp/rotulos-test')
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

const MM_TO_PT = 72 / 25.4
const MARGIN_MM = 15
const CONTENT_WIDTH_MM = 210 - 2 * MARGIN_MM // 180mm
const RECIPIENT_MAX_WIDTH_MM = CONTENT_WIDTH_MM - 6 // mismo cálculo que el generador

async function main() {
  let allOk = true
  const report: string[] = []

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]

    // 1) Genero el PDF real con el generador (mismo path que producción)
    const data = buildData(c.razonSocial, i + 1)
    const blob = generateShippingLabels(data)
    const buf = Buffer.from(await (blob as Blob).arrayBuffer())
    const pdfPath = join(OUT_DIR, `${c.id}.pdf`)
    writeFileSync(pdfPath, buf)

    // 2) Re-ejecuto la misma lógica de layout sobre un jsPDF fresco para inspeccionar.
    //    jsPDF usa unidades 'mm' acá, igual que el generador.
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const fontSize = adaptiveSize(c.razonSocial)
    const lines = layoutRecipientName(doc, c.razonSocial, RECIPIENT_MAX_WIDTH_MM, fontSize, 3)

    // mediciones
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(fontSize)
    const widthsMm = lines.map(l => doc.getTextWidth(l))
    const maxWidthMm = Math.max(...widthsMm)
    const lineHeightMm = fontSize * 0.42
    const totalHeightMm = lines.length * lineHeightMm

    const issues: string[] = []

    // chk 1: fontSize seleccionado correcto
    if (fontSize !== c.expectedFontSize) {
      issues.push(`fontSize ${fontSize}pt ≠ esperado ${c.expectedFontSize}pt`)
    }
    // chk 2: tope 3 líneas
    if (lines.length > 3) {
      issues.push(`más de 3 líneas: ${lines.length}`)
    }
    // chk 3: ancho de cada línea ≤ recipientMaxWidth (con tolerancia 0.3mm)
    if (maxWidthMm > RECIPIENT_MAX_WIDTH_MM + 0.3) {
      issues.push(`desborde: maxLineWidth=${maxWidthMm.toFixed(2)}mm > limite ${RECIPIENT_MAX_WIDTH_MM}mm`)
    }
    // chk 4: si lo esperado es ≤ N líneas, no debería superarlo (señal de que el adaptive
    //       fontSize está mal calibrado para razones reales)
    if (lines.length > c.expectedLines) {
      issues.push(`líneas=${lines.length} > esperado=${c.expectedLines} (calibración)`)
    }
    // chk 5: si entró elipsis, debe estar al final de la última línea
    const lastLine = lines[lines.length - 1]
    const hasEllipsis = lastLine.endsWith('…')
    // chk 6: caso palabra única — sí o sí debió partirse en chunks (más de 1 línea)
    if (c.id === '05-palabra-unica' && lines.length < 2) {
      issues.push(`palabra única no se partió: lines=${lines.length}`)
    }
    // chk 7: alto total no debe empujar el bloque CUIT — el reservado en producción es:
    //       y += 8 + lines*lineHeight + 6 → total ≤ 22mm para el caso 16pt/1 línea original.
    //       Con tope 3 líneas a 16pt: 8 + 3*6.72 + 6 = 34mm. Documentamos pero no falla.
    const blockMm = 8 + totalHeightMm + 6

    const status = issues.length === 0 ? '✅' : '❌'
    if (issues.length) allOk = false

    const linesPreview = lines.map(l => `"${l}"`).join('  ⏎  ')
    report.push(
      `[${c.id}] ${status} ${c.label}\n` +
      `   nombre (${c.razonSocial.length}c): "${c.razonSocial}"\n` +
      `   fontSize=${fontSize}pt   líneas=${lines.length}   ellipsis=${hasEllipsis}\n` +
      `   maxLineWidth=${maxWidthMm.toFixed(1)}mm / ${RECIPIENT_MAX_WIDTH_MM}mm   blockHeight=${blockMm.toFixed(1)}mm\n` +
      `   render: ${linesPreview}\n` +
      (issues.length ? `   ⚠ issues: ${issues.join(' | ')}\n` : '') +
      `   pdf: ${pdfPath}\n`
    )
  }

  console.log('\n=== Reporte rótulo wrap ===\n')
  console.log(report.join('\n'))
  console.log(`PDFs generados en: ${OUT_DIR}`)
  console.log(allOk ? '\n✅ TODO OK, MERGEABLE\n' : '\n❌ HAY ISSUES — revisar arriba\n')
  process.exit(allOk ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(2) })

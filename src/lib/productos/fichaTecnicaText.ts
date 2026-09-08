/**
 * Texto de la ficha técnica de un producto.
 *
 * Las fichas (PDF del fabricante) viven en public/uploads/fichas-tecnicas y
 * hasta ahora solo se adjuntaban a cotizaciones. Acá se extrae su texto una
 * sola vez y se guarda en Product.technicalSheetText para que la IA de
 * preguntas de ML responda lo técnico (rosca, norma, materiales, presión,
 * dimensiones) con la ficha y no con la descripción corta del ERP.
 *
 * technicalSheetTextAt marca que ya se intentó extraer (aunque haya salido
 * null: ficha en imagen o PDF escaneado sin capa de texto) para no reintentar
 * en cada pregunta.
 */

import { readFile } from 'fs/promises'
import path from 'path'
import { extractText } from 'unpdf'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

// Las fichas son de 1 a 4 páginas; el tope protege el prompt de catálogos
// enteros subidos como ficha.
export const TECHNICAL_SHEET_TEXT_MAX_CHARS = 12_000

/** Ruta absoluta en disco de una ficha a partir de su URL pública (/uploads/...). */
export function technicalSheetPath(technicalSheetUrl: string): string {
  return path.join(process.cwd(), 'public', technicalSheetUrl)
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Extrae el texto de un PDF (buffer). Devuelve null si no es PDF, si no tiene
 * capa de texto, o si pdf.js no lo puede abrir.
 */
export async function extractPdfText(data: Buffer | Uint8Array): Promise<string | null> {
  // pdf.js rechaza Buffer (aunque sea subclase de Uint8Array): copia plana.
  const bytes = new Uint8Array(data)
  const { text } = await extractText(bytes, { mergePages: true })
  const clean = normalizeText(text ?? '')
  if (clean.length < 20) return null
  return clean.slice(0, TECHNICAL_SHEET_TEXT_MAX_CHARS)
}

/** Extrae el texto de la ficha de un producto desde su archivo en disco. */
export async function extractTechnicalSheetText(technicalSheetUrl: string): Promise<string | null> {
  if (!technicalSheetUrl.toLowerCase().endsWith('.pdf')) return null
  const data = await readFile(technicalSheetPath(technicalSheetUrl))
  return extractPdfText(data)
}

/**
 * Garantiza que el producto tenga el texto de su ficha extraído (si tiene
 * ficha y todavía no se intentó). Devuelve el texto (o null). Nunca tira:
 * un PDF roto no debe frenar la respuesta a una pregunta.
 */
export async function ensureTechnicalSheetText(product: {
  id: string
  technicalSheetUrl: string | null
  technicalSheetText: string | null
  technicalSheetTextAt: Date | null
}): Promise<string | null> {
  if (!product.technicalSheetUrl) return null
  if (product.technicalSheetTextAt) return product.technicalSheetText

  let text: string | null = null
  try {
    text = await extractTechnicalSheetText(product.technicalSheetUrl)
  } catch (err) {
    logger.error(`[Ficha técnica] No se pudo extraer texto de ${product.technicalSheetUrl}`, err)
  }
  await prisma.product.update({
    where: { id: product.id },
    data: { technicalSheetText: text, technicalSheetTextAt: new Date() },
  })
  return text
}

import type { jsPDF } from 'jspdf'

/**
 * Helpers compartidos de layout de texto para generadores de PDF jsPDF.
 *
 * Resuelven dos problemas:
 *   1. splitTextToSize de jsPDF corta solo por espacios → se desborda con
 *      palabras larguísimas sin espacios.
 *   2. Texto largo puede empujar el layout vertical más allá de lo previsto.
 *
 * `breakLongWords` mide cada palabra al fontSize actual del doc y la parte
 * en chunks que entren al maxWidth. `layoutLongTextBlock` combina ese
 * blindaje con splitTextToSize y aplica un tope de líneas con ellipsis.
 */

/**
 * Si una palabra excede `maxWidth` al font/size actual del `doc`, la parte
 * en chunks que sí entren. Asume que el caller ya seteó fuente y tamaño.
 */
export function breakLongWords(doc: jsPDF, text: string, maxWidth: number): string {
  const tokens = text.split(/(\s+)/)
  const out: string[] = []
  for (const tok of tokens) {
    if (!tok) continue
    if (/^\s+$/.test(tok) || doc.getTextWidth(tok) <= maxWidth) {
      out.push(tok)
      continue
    }
    let chunk = ''
    for (const ch of Array.from(tok)) {
      if (chunk && doc.getTextWidth(chunk + ch) > maxWidth) {
        out.push(chunk)
        out.push(' ')
        chunk = ch
      } else {
        chunk += ch
      }
    }
    if (chunk) out.push(chunk)
  }
  return out.join('')
}

export interface LayoutTextOptions {
  maxWidth: number
  fontSize: number
  maxLines: number
  fontStyle?: 'normal' | 'bold' | 'italic' | 'bolditalic'
  fontFamily?: string
}

/**
 * Devuelve un array de líneas listas para `doc.text(lines, x, y)`:
 *   - Aplica blindaje contra palabras sin espacios.
 *   - Wrappea con `splitTextToSize` al `maxWidth`.
 *   - Capa en `maxLines` y agrega "…" al final de la última línea
 *     (recortando lo necesario para que la elipsis quepa).
 *
 * Setea fuente + tamaño en el `doc` como side-effect (necesario para medir).
 */
export function layoutLongTextBlock(
  doc: jsPDF,
  text: string,
  opts: LayoutTextOptions,
): string[] {
  const { maxWidth, fontSize, maxLines } = opts
  const fontFamily = opts.fontFamily ?? 'helvetica'
  const fontStyle = opts.fontStyle ?? 'normal'

  doc.setFont(fontFamily, fontStyle)
  doc.setFontSize(fontSize)

  const safe = breakLongWords(doc, text, maxWidth)
  const all = doc.splitTextToSize(safe, maxWidth) as string[]
  if (all.length <= maxLines) return all

  const truncated = all.slice(0, maxLines)
  const lastIdx = truncated.length - 1
  let last = truncated[lastIdx]
  while (last.length > 0 && doc.getTextWidth(last + '…') > maxWidth) {
    last = last.slice(0, -1)
  }
  truncated[lastIdx] = last + '…'
  return truncated
}

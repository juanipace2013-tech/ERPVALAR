/**
 * Detecta si un ítem manual de cotización en realidad es un producto del
 * catálogo. Un ítem manual no está vinculado a ningún producto, así que el
 * tablero de facturación no ve su stock (caso SYNTHON VAL-2026-3666: el código
 * estaba escrito al principio de la descripción).
 */

/**
 * Códigos candidatos, en orden de prioridad: el SKU manual, y las dos primeras
 * palabras / la primera palabra de la descripción (hay SKUs con espacio, ej.
 * "2094 12" de GENEBRE).
 */
export function candidateCodes(manualSku: string, description: string): string[] {
  const out: string[] = []
  const add = (s: string | undefined) => {
    const v = (s || '').trim()
    if (v.length >= 3 && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v)
  }
  add(manualSku)
  const words = (description || '').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) add(`${words[0]} ${words[1]}`)
  add(words[0])
  return out
}

/** Primer producto cuyo SKU coincide exacto (sin distinguir mayúsculas) con un candidato. */
export function findExactSkuMatch<T extends { sku: string }>(
  candidates: string[],
  products: T[]
): T | null {
  for (const c of candidates) {
    const hit = products.find((p) => p.sku.trim().toLowerCase() === c.toLowerCase())
    if (hit) return hit
  }
  return null
}

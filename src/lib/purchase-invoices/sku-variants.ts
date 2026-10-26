/**
 * Forma "comparable" de un SKU: minúsculas y sin espacios, guiones ni otros
 * separadores. GENEBRE factura "5800-140" y "451902 C24" para lo que el
 * catálogo tiene como "5800 140" y "4519 02 C24"; normalizados coinciden.
 */
export function normalizeSkuForMatch(sku: string): string {
  return sku.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Código base sin el último segmento, para códigos de 3+ partes.
 * GENEBRE factura "4427 08 99" (variante: sin bobina) para lo que el catálogo
 * tiene como "4427 08". Se usa solo como último recurso, cuando el código
 * completo no matchea, y solo si el código base da un único producto.
 * Devuelve null si el código tiene menos de 3 partes.
 */
export function stripTrailingSegment(supplierCode: string): string | null {
  const parts = supplierCode.trim().split(/\s+/)
  if (parts.length < 3) return null
  return parts.slice(0, -1).join(' ')
}

/**
 * Variantes de un código de proveedor para buscarlo como SKU del catálogo,
 * quitando progresivamente los ceros iniciales de la primera parte.
 * Ej: "0012416 04" → ["2416 04", "12416 04", "012416 04", "0012416 04"]
 */
export function generateSkuVariants(supplierCode: string): string[] {
  const code = supplierCode.trim()
  if (!code) return []

  const parts = code.split(/\s+/)
  const variants: string[] = []
  const seen = new Set<string>()

  const addVariant = (v: string) => {
    if (!seen.has(v)) {
      seen.add(v)
      variants.push(v)
    }
  }

  const firstPartStripped = parts[0].replace(/^0+/, '') || parts[0]
  const rest = parts.slice(1)
  addVariant([firstPartStripped, ...rest].join(' '))

  let current = firstPartStripped
  for (let i = 1; i <= parts[0].length - firstPartStripped.length; i++) {
    current = '0' + current
    addVariant([current, ...rest].join(' '))
  }

  addVariant(code)

  return variants
}

// Posicionadores opcionales para válvulas de control GENEBRE.
// Fuente: "Lista Nº 16 - INDUSTRIAL" (vigencia 01/04/2025), pág. 26: debajo de
// la válvula neumática modulante 5065A figuran los posicionadores lineales
// electroneumáticos para su actuador a diafragma (Art. 5952 y 5952 04).
// Con un click se agrega el posicionador elegido como adicional del item; va
// uno solo por válvula, así que elegir otro reemplaza al anterior.

export interface PosicionadorOpcion {
  sku: string
  label: string
}

const POSICIONADORES_LINEALES: PosicionadorOpcion[] = [
  { sku: '5952 00', label: '4-20 mA' },
  { sku: '5952 04', label: '4-20 mA c/ retransmisor' },
]

// Serie de la válvula (primer tramo del SKU, ej: "5065A 12" → "5065A")
const SERIES: Record<string, PosicionadorOpcion[]> = {
  '5065A': POSICIONADORES_LINEALES,
}

// Devuelve los posicionadores que se pueden ofrecer para un SKU de válvula
// (vacío si la serie no lleva posicionador)
export function getPosicionadores(sku: string): PosicionadorOpcion[] {
  const serie = sku.trim().split(/\s+/)[0]
  return SERIES[serie] ?? []
}

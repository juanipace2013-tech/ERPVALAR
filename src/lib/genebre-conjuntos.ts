// Conjuntos armados GENEBRE: tabla de aplicación estándar de actuadores sobre válvulas.
// Fuente: "Genebre Tabla ACTUADORES v22.09.pdf" (Listado de Precios/Genebre).
// Cada SKU de válvula mapea a los kits de motorización disponibles (actuador + dados adaptadores).
// Los SKUs referencian productos reales del catálogo (formato con espacios: "5800 122", "5012 09 11").

export type ConjuntoTipo =
  | 'DOBLE_EFECTO'
  | 'SIMPLE_EFECTO'
  | 'ELECTRICO'
  | 'ELECTRICO_TRIFASICO'
  | 'REDUCTOR_MANUAL'

export const CONJUNTO_LABELS: Record<ConjuntoTipo, string> = {
  DOBLE_EFECTO: 'Neum. Doble Efecto',
  SIMPLE_EFECTO: 'Neum. Simple Efecto',
  ELECTRICO: 'Eléctrico',
  ELECTRICO_TRIFASICO: 'Eléctrico Trifásico',
  REDUCTOR_MANUAL: 'Reductor manual',
}

export interface ConjuntoKit {
  actuadorSku?: string
  dadoSkus?: string[]
  // El PDF indica "COTIZAR" para esta combinación: se muestra deshabilitado
  cotizar?: boolean
  nota?: string
}

type FilaConjuntos = Partial<Record<ConjuntoTipo, ConjuntoKit>>

// Notación compacta: kit(actuador, ...dados)
const kit = (actuadorSku: string, ...dadoSkus: string[]): ConjuntoKit => ({
  actuadorSku,
  dadoSkus,
})

const COTIZAR: ConjuntoKit = { cotizar: true }

// ── Esféricas 2025 / 2025N / 2026 / 2027 ────────────────────────────────────
const SERIE_2025: Record<string, FilaConjuntos> = {
  '02': { DOBLE_EFECTO: kit('5800 120', '5012 09 11'), SIMPLE_EFECTO: kit('5800 124', '5012 09 11'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '03': { DOBLE_EFECTO: kit('5800 120', '5012 09 11'), SIMPLE_EFECTO: kit('5800 124', '5012 09 11'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '04': { DOBLE_EFECTO: kit('5800 122', '5012 09 11'), SIMPLE_EFECTO: kit('5800 126', '5012 09 11'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '05': { DOBLE_EFECTO: kit('5800 122'), SIMPLE_EFECTO: kit('5800 134', '5012 11 14'), ELECTRICO: kit('5803 51', '5012 11 14') },
  '06': { DOBLE_EFECTO: kit('5800 122'), SIMPLE_EFECTO: kit('5800 136', '5012 11 14'), ELECTRICO: kit('5803 51', '5012 11 14') },
  '07': { DOBLE_EFECTO: kit('5800 128'), SIMPLE_EFECTO: kit('5800 140'), ELECTRICO: kit('5803 51') },
  '08': { DOBLE_EFECTO: kit('5800 128'), SIMPLE_EFECTO: kit('5800 144', '5012 14 17'), ELECTRICO: kit('5803 47'), REDUCTOR_MANUAL: kit('5984 04') },
  '09': { DOBLE_EFECTO: kit('5800 128'), SIMPLE_EFECTO: kit('5800 148', '5012 14 17'), ELECTRICO: kit('5803 52', '5012 14 17'), REDUCTOR_MANUAL: kit('5984 04') },
  '10': { DOBLE_EFECTO: kit('5800 142'), SIMPLE_EFECTO: kit('5800 152', '5012 17 22'), ELECTRICO: kit('5803 52'), REDUCTOR_MANUAL: kit('5984 05', '5012 17 22') },
  '11': { DOBLE_EFECTO: kit('5800 142'), SIMPLE_EFECTO: kit('5800 160', '5012 17 22'), ELECTRICO: kit('5803 48'), REDUCTOR_MANUAL: kit('5984 05', '5012 17 22') },
  '12': { DOBLE_EFECTO: kit('5800 150', '5012 17 22'), SIMPLE_EFECTO: kit('5800 164', '5012 17 22', '5012 22 27'), ELECTRICO: kit('5803 53', '5012 17 22'), REDUCTOR_MANUAL: kit('5984 05', '5012 17 22') },
}

// ── Esféricas 2040 / 2041 ───────────────────────────────────────────────────
const SERIE_2040: Record<string, FilaConjuntos> = {
  '02': { DOBLE_EFECTO: kit('5800 122', '5012 09 11'), SIMPLE_EFECTO: kit('5800 124', '5012 09 11'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '03': { DOBLE_EFECTO: kit('5800 122', '5012 09 11'), SIMPLE_EFECTO: kit('5800 124', '5012 09 11'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '04': { DOBLE_EFECTO: kit('5800 122', '5012 09 11'), SIMPLE_EFECTO: kit('5800 124', '5012 09 11'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '05': { DOBLE_EFECTO: kit('5800 122'), SIMPLE_EFECTO: kit('5800 134', '5012 11 14'), ELECTRICO: kit('5803 51', '5012 11 14') },
  '06': { DOBLE_EFECTO: kit('5800 128', '5012 11 14'), SIMPLE_EFECTO: kit('5800 134', '5012 11 14'), ELECTRICO: kit('5803 51', '5012 11 14') },
  '07': { DOBLE_EFECTO: kit('5800 128'), SIMPLE_EFECTO: kit('5800 140'), ELECTRICO: kit('5803 51') },
  '08': { DOBLE_EFECTO: kit('5800 128'), SIMPLE_EFECTO: kit('5800 144', '5012 14 17'), ELECTRICO: kit('5803 47') },
  '09': { DOBLE_EFECTO: kit('5800 138'), SIMPLE_EFECTO: kit('5800 152', '5012 14 17', '5012 17 22'), ELECTRICO: kit('5803 52', '5012 14 17') },
  '10': { DOBLE_EFECTO: kit('5800 142'), SIMPLE_EFECTO: kit('5800 156', '5012 17 22'), ELECTRICO: kit('5803 48') },
}

// ── Esféricas 2526A / 2528A ─────────────────────────────────────────────────
const SERIE_2526A: Record<string, FilaConjuntos> = {
  '04': { DOBLE_EFECTO: kit('5800 122', '5012 09 11'), SIMPLE_EFECTO: kit('5800 134', '5012 09 14'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '05': { DOBLE_EFECTO: kit('5800 122', '5012 09 11'), SIMPLE_EFECTO: kit('5800 132', '5012 09 14'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '06': { DOBLE_EFECTO: kit('5800 122'), SIMPLE_EFECTO: kit('5800 136', '5012 11 14'), ELECTRICO: kit('5803 51', '5012 11 14') },
  '07': { DOBLE_EFECTO: kit('5800 128'), SIMPLE_EFECTO: kit('5800 140'), ELECTRICO: kit('5803 51') },
  '08': { DOBLE_EFECTO: kit('5800 128'), SIMPLE_EFECTO: kit('5800 144', '5012 14 17'), ELECTRICO: kit('5803 47') },
  '09': { DOBLE_EFECTO: kit('5800 128'), SIMPLE_EFECTO: kit('5800 148', '5012 14 17'), ELECTRICO: kit('5803 52', '5012 14 17') },
  '10': { DOBLE_EFECTO: kit('5800 142'), SIMPLE_EFECTO: kit('5800 152', '5012 17 22'), ELECTRICO: kit('5803 52') },
  '11': { DOBLE_EFECTO: kit('5800 142'), SIMPLE_EFECTO: kit('5800 160', '5012 17 22'), ELECTRICO: kit('5803 48') },
  '12': { DOBLE_EFECTO: kit('5800 150', '5012 17 22'), SIMPLE_EFECTO: kit('5800 164', '5012 17 22', '5012 22 27'), ELECTRICO: kit('5803 53', '5012 17 22') },
  '14': { DOBLE_EFECTO: kit('5800 162'), SIMPLE_EFECTO: kit('5800 172', '5012 27 36'), ELECTRICO_TRIFASICO: kit('5803 56'), REDUCTOR_MANUAL: kit('5984 06') },
}

// ── Esférica 2118 ───────────────────────────────────────────────────────────
const SERIE_2118: Record<string, FilaConjuntos> = {
  '04': { DOBLE_EFECTO: kit('5800 122', '5012 09 11'), SIMPLE_EFECTO: kit('5800 134', '5012 09 14'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '05': { DOBLE_EFECTO: kit('5800 122', '5012 09 11'), SIMPLE_EFECTO: kit('5800 134', '5012 09 14'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '06': { DOBLE_EFECTO: kit('5800 122'), SIMPLE_EFECTO: kit('5800 136', '5012 11 14'), ELECTRICO: kit('5803 51', '5012 11 14') },
  '07': { DOBLE_EFECTO: kit('5800 128', '5012 11 14'), SIMPLE_EFECTO: kit('5800 140', '5012 11 14'), ELECTRICO: kit('5803 51', '5012 11 14') },
  '08': { DOBLE_EFECTO: kit('5800 128'), SIMPLE_EFECTO: kit('5800 144', '5012 14 17'), ELECTRICO: kit('5803 47') },
  '09': { DOBLE_EFECTO: kit('5800 128'), SIMPLE_EFECTO: kit('5800 148', '5012 14 17'), ELECTRICO: kit('5803 52', '5012 14 17') },
  '10': { DOBLE_EFECTO: kit('5800 142'), SIMPLE_EFECTO: kit('5800 152', '5012 17 22'), ELECTRICO: kit('5803 52') },
  '11': { DOBLE_EFECTO: kit('5800 142'), SIMPLE_EFECTO: kit('5800 160', '5012 17 22'), ELECTRICO: kit('5803 48') },
  '12': { DOBLE_EFECTO: kit('5800 150', '5012 17 22'), SIMPLE_EFECTO: kit('5800 164', '5012 17 22', '5012 22 27'), ELECTRICO: kit('5803 53', '5012 17 22') },
}

// ── Esférica 2933 (INOX 316L 3 piezas) ──────────────────────────────────────
const SERIE_2933: Record<string, FilaConjuntos> = {
  '04': { DOBLE_EFECTO: kit('5800 120', '5012 09 14'), SIMPLE_EFECTO: kit('5800 126', '5012 09 11'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '05': { DOBLE_EFECTO: kit('5800 120', '5012 09 14'), SIMPLE_EFECTO: kit('5800 134', '5012 09 14'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '06': { DOBLE_EFECTO: kit('5800 122', '5012 11 14'), SIMPLE_EFECTO: kit('5800 136', '5012 11 14'), ELECTRICO: kit('5803 51', '5012 11 14') },
  '08': { DOBLE_EFECTO: kit('5800 128'), SIMPLE_EFECTO: kit('5800 144', '5012 14 17'), ELECTRICO: kit('5803 47') },
  '09': { DOBLE_EFECTO: kit('5800 128'), SIMPLE_EFECTO: kit('5800 148', '5012 14 17'), ELECTRICO: kit('5803 52', '5012 14 17') },
  '10': { DOBLE_EFECTO: kit('5800 142'), SIMPLE_EFECTO: kit('5800 152', '5012 17 22'), ELECTRICO: kit('5803 52') },
  '11': { DOBLE_EFECTO: kit('5800 142', '5012 17 22'), SIMPLE_EFECTO: kit('5800 160', '5012 17 22'), ELECTRICO: kit('5803 48') },
  '12': { DOBLE_EFECTO: kit('5800 150'), SIMPLE_EFECTO: kit('5800 164', '5012 22 27'), ELECTRICO: kit('5803 53') },
}

// ── Esférica 3023 ───────────────────────────────────────────────────────────
const SERIE_3023: Record<string, FilaConjuntos> = {
  '04': { DOBLE_EFECTO: kit('5800 120', '5012 09 11'), SIMPLE_EFECTO: kit('5800 124', '5012 09 11'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '05': { DOBLE_EFECTO: kit('5800 120', '5012 09 11'), SIMPLE_EFECTO: kit('5800 124', '5012 09 11'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '06': { DOBLE_EFECTO: kit('5800 122', '5012 09 11'), SIMPLE_EFECTO: kit('5800 134', '5012 09 14'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '07': { DOBLE_EFECTO: kit('5800 128', '5012 11 14'), SIMPLE_EFECTO: kit('5800 132', '5012 11 14'), ELECTRICO: kit('5803 51', '5012 11 14') },
  '08': { DOBLE_EFECTO: kit('5800 128', '5012 11 14'), SIMPLE_EFECTO: kit('5800 140', '5012 11 14'), ELECTRICO: kit('5803 51', '5012 11 14') },
  '09': { DOBLE_EFECTO: kit('5800 128', '5012 11 14'), SIMPLE_EFECTO: kit('5800 144', '5012 11 17'), ELECTRICO: kit('5803 47', '5012 11 14') },
}

// ── Esféricas 3 vías 3272E / 3282E ──────────────────────────────────────────
const SERIE_3272E: Record<string, FilaConjuntos> = {
  '04': { DOBLE_EFECTO: kit('5800 120', '5012 09 11'), SIMPLE_EFECTO: kit('5800 124', '5012 09 11'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '05': { DOBLE_EFECTO: kit('5800 122', '5012 09 11'), SIMPLE_EFECTO: kit('5800 134', '5012 09 14'), ELECTRICO: kit('5803 51', '5012 09 14') },
  '06': { DOBLE_EFECTO: kit('5800 122', '5012 09 11'), SIMPLE_EFECTO: kit('5800 134', '5012 09 14'), ELECTRICO: kit('5803 51', '5012 09 14') },
}

// ── Mariposas 2109 / 2109B / 2108A ──────────────────────────────────────────
const SERIE_2109: Record<string, FilaConjuntos> = {
  '09': { DOBLE_EFECTO: kit('5800 128', '5012 11 14'), SIMPLE_EFECTO: kit('5800 132', '5012 11 14'), ELECTRICO: kit('5803 52', '5012 11 17'), REDUCTOR_MANUAL: kit('5975', '5012 11 17') },
  '10': { DOBLE_EFECTO: kit('5800 128', '5012 11 14'), SIMPLE_EFECTO: kit('5800 144', '5012 11 17'), ELECTRICO: kit('5803 52', '5012 11 17'), REDUCTOR_MANUAL: kit('5975', '5012 11 17') },
  '11': { DOBLE_EFECTO: kit('5800 128', '5012 11 14'), SIMPLE_EFECTO: kit('5800 148', '5012 11 17'), ELECTRICO: kit('5803 52', '5012 11 17'), REDUCTOR_MANUAL: kit('5975', '5012 11 17') },
  '12': { DOBLE_EFECTO: kit('5800 138'), SIMPLE_EFECTO: kit('5800 148', '5012 14 17'), ELECTRICO: kit('5803 48', '5012 14 17'), REDUCTOR_MANUAL: kit('5975', '5012 14 17') },
  '13': { DOBLE_EFECTO: kit('5800 142', '5012 14 17'), SIMPLE_EFECTO: kit('5800 154', '5012 14 17', '5012 17 22'), ELECTRICO: kit('5803 48', '5012 14 17'), REDUCTOR_MANUAL: kit('5975', '5012 14 17') },
  '14': { DOBLE_EFECTO: kit('5800 142', '5012 14 17'), SIMPLE_EFECTO: kit('5800 156', '5012 14 17', '5012 17 22'), ELECTRICO: kit('5803 53', '5012 14 17', '5012 17 22'), REDUCTOR_MANUAL: kit('5975', '5012 14 17') },
  '16': { DOBLE_EFECTO: kit('5800 150', '5012 17 22'), SIMPLE_EFECTO: kit('5800 164', '5012 17 22', '5012 22 27'), ELECTRICO: kit('5803 54', '5012 17 22'), REDUCTOR_MANUAL: kit('5976', '5012 17 22') },
  '18': { DOBLE_EFECTO: kit('5800 158'), SIMPLE_EFECTO: kit('5800 168', '5012 22 27'), ELECTRICO_TRIFASICO: kit('5803 56', '5012 22 27'), REDUCTOR_MANUAL: kit('5976') },
  '20': { DOBLE_EFECTO: kit('5800 162', '5012 22 27'), SIMPLE_EFECTO: kit('5800 172', '5012 22 27', '5012 27 36'), ELECTRICO_TRIFASICO: kit('5803 62', '5012 22 27') },
  '22': { DOBLE_EFECTO: kit('5800 170', '5012 22 27', '5012 27 36'), SIMPLE_EFECTO: COTIZAR, ELECTRICO_TRIFASICO: kit('5803 57', '5012 22 27') },
  '24': { DOBLE_EFECTO: kit('5800 170', '5012 27 36'), SIMPLE_EFECTO: COTIZAR },
  '26': { DOBLE_EFECTO: kit('5800 174', '5012 27 36') },
  '28': { DOBLE_EFECTO: kit('5800 176', '5012 36 46') },
}

// ── Mariposas 2104 ──────────────────────────────────────────────────────────
const NOTA_MONTAJE_2104_13_14 =
  'Según tabla GENEBRE requiere además kit de montaje 5008-32 + eje extensión 5505 10 22 (no cargados en catálogo — cotizar aparte).'
const NOTA_MONTAJE_2104_16 =
  'Según tabla GENEBRE requiere además kit de montaje 5008-102 + eje extensión 5510 13 36 (no cargados en catálogo — cotizar aparte).'

const SERIE_2104: Record<string, FilaConjuntos> = {
  '09': { DOBLE_EFECTO: kit('5800 128', '5012 11 14'), SIMPLE_EFECTO: kit('5800 144', '5012 11 17'), ELECTRICO: kit('5803 52', '5012 11 17') },
  '10': { DOBLE_EFECTO: kit('5800 128', '5012 11 14'), SIMPLE_EFECTO: kit('5800 144', '5012 11 17'), ELECTRICO: kit('5803 52', '5012 11 17') },
  '11': { DOBLE_EFECTO: kit('5800 138', '5012 11 14'), SIMPLE_EFECTO: kit('5800 148', '5012 11 17'), ELECTRICO: kit('5803 52', '5012 11 17') },
  '12': { DOBLE_EFECTO: kit('5800 142', '5012 14 17'), SIMPLE_EFECTO: kit('5800 156', '5012 14 17', '5012 17 22'), ELECTRICO: kit('5803 48', '5012 14 17') },
  '13': {
    DOBLE_EFECTO: kit('5800 150', '5012 14 17', '5012 17 22'),
    SIMPLE_EFECTO: { ...kit('5800 164', '5012 14 17', '5012 17 22', '5012 22 27'), nota: NOTA_MONTAJE_2104_13_14 },
    ELECTRICO: kit('5803 53', '5012 14 17', '5012 17 22'),
  },
  '14': {
    DOBLE_EFECTO: kit('5800 158', '5012 14 17', '5012 17 22'),
    SIMPLE_EFECTO: { ...kit('5800 168', '5012 14 17', '5012 17 22', '5012 22 27'), nota: NOTA_MONTAJE_2104_13_14 },
    ELECTRICO: kit('5803 54', '5012 14 17', '5012 17 22'),
  },
  '16': {
    DOBLE_EFECTO: kit('5800 162', '5012 17 22', '5012 22 27'),
    SIMPLE_EFECTO: { ...kit('5800 172', '5012 17 22', '5012 22 27', '5012 27 36'), nota: NOTA_MONTAJE_2104_16 },
  },
}

// Series equivalentes: comparten la misma fila de la tabla GENEBRE
const SERIES: Array<{ tabla: Record<string, FilaConjuntos>; prefijos: string[] }> = [
  { tabla: SERIE_2025, prefijos: ['2025', '2025N', '2026', '2027'] },
  { tabla: SERIE_2040, prefijos: ['2040', '2041'] },
  { tabla: SERIE_2526A, prefijos: ['2526A', '2528A'] },
  { tabla: SERIE_2118, prefijos: ['2118'] },
  { tabla: SERIE_2933, prefijos: ['2933'] },
  { tabla: SERIE_3023, prefijos: ['3023'] },
  { tabla: SERIE_3272E, prefijos: ['3272E', '3282E'] },
  { tabla: SERIE_2109, prefijos: ['2109', '2109B', '2108A'] },
  { tabla: SERIE_2104, prefijos: ['2104'] },
]

const CONJUNTOS_POR_SKU = new Map<string, FilaConjuntos>()
for (const { tabla, prefijos } of SERIES) {
  for (const [medida, fila] of Object.entries(tabla)) {
    for (const prefijo of prefijos) {
      CONJUNTOS_POR_SKU.set(`${prefijo} ${medida}`, fila)
    }
  }
}

// Excepción del PDF: 2108A 14 (6") lleva reductor 5975 SIN dado, únicamente esa medida
CONJUNTOS_POR_SKU.set('2108A 14', {
  ...CONJUNTOS_POR_SKU.get('2108A 14'),
  REDUCTOR_MANUAL: { actuadorSku: '5975', dadoSkus: [], nota: '2108A 14 (6"): el reductor 5975 va SIN dado (excepción de la tabla GENEBRE).' },
})

export interface ConjuntoOpcion extends ConjuntoKit {
  tipo: ConjuntoTipo
  label: string
}

const ORDEN_TIPOS: ConjuntoTipo[] = [
  'DOBLE_EFECTO',
  'SIMPLE_EFECTO',
  'ELECTRICO',
  'ELECTRICO_TRIFASICO',
  'REDUCTOR_MANUAL',
]

// Devuelve los conjuntos armados disponibles para un SKU de válvula (vacío si no aplica)
export function getConjuntosGenebre(sku: string): ConjuntoOpcion[] {
  const fila = CONJUNTOS_POR_SKU.get(sku.trim())
  if (!fila) return []
  return ORDEN_TIPOS.filter((tipo) => fila[tipo]).map((tipo) => ({
    tipo,
    label: CONJUNTO_LABELS[tipo],
    ...fila[tipo]!,
  }))
}

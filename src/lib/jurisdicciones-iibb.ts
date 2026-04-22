/**
 * Mapeo de jurisdicciones IIBB (Ingresos Brutos argentinos).
 *
 * Los Ingresos Brutos son provinciales: CABA + 23 provincias = 24 jurisdicciones.
 * "NACIONAL" NO es una jurisdicción IIBB válida — se usa solo para IVA/Ganancias/SUSS.
 *
 * Los nombres canónicos (valores) son los que Colppy espera EXACTAMENTE
 * (respetando tildes y mayúsculas).
 */

/** 24 jurisdicciones IIBB con el nombre EXACTO que espera Colppy. */
export const COLPPY_JURISDICCIONES = [
  'CABA',
  'Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fé',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
] as const

export type JurisdiccionIIBB = (typeof COLPPY_JURISDICCIONES)[number]

/** Normaliza: lowercase, sin tildes, sin puntuación, espacios colapsados. */
function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9\s]/g, ' ') // puntuación → espacio
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Aliases en forma NORMALIZADA → nombre canónico Colppy.
 * Incluye el nombre canónico propio y variantes abreviadas comunes.
 * Los prefijos "IB ", "IIBB ", "PERCEP " se manejan por substring-match.
 */
const ALIASES: Record<string, JurisdiccionIIBB> = {
  // CABA
  'caba': 'CABA',
  'agip': 'CABA',
  'capital federal': 'CABA',
  'ciudad de buenos aires': 'CABA',
  'ciudad autonoma de buenos aires': 'CABA',

  // Buenos Aires
  'buenos aires': 'Buenos Aires',
  'arba': 'Buenos Aires',
  'bs as': 'Buenos Aires',
  'bsas': 'Buenos Aires',
  'pba': 'Buenos Aires',
  'pcia buenos aires': 'Buenos Aires',
  'provincia de buenos aires': 'Buenos Aires',

  // Catamarca
  'catamarca': 'Catamarca',

  // Chaco
  'chaco': 'Chaco',

  // Chubut
  'chubut': 'Chubut',

  // Córdoba
  'cordoba': 'Córdoba',

  // Corrientes
  'corrientes': 'Corrientes',

  // Entre Ríos
  'entre rios': 'Entre Ríos',

  // Formosa
  'formosa': 'Formosa',

  // Jujuy
  'jujuy': 'Jujuy',

  // La Pampa
  'la pampa': 'La Pampa',

  // La Rioja
  'la rioja': 'La Rioja',

  // Mendoza
  'mendoza': 'Mendoza',

  // Misiones
  'misiones': 'Misiones',

  // Neuquén
  'neuquen': 'Neuquén',

  // Río Negro
  'rio negro': 'Río Negro',

  // Salta
  'salta': 'Salta',

  // San Juan
  'san juan': 'San Juan',

  // San Luis
  'san luis': 'San Luis',

  // Santa Cruz
  'santa cruz': 'Santa Cruz',

  // Santa Fé
  'santa fe': 'Santa Fé',
  'sta fe': 'Santa Fé',

  // Santiago del Estero
  'santiago del estero': 'Santiago del Estero',
  'sgo del estero': 'Santiago del Estero',

  // Tierra del Fuego
  'tierra del fuego': 'Tierra del Fuego',
  't del fuego': 'Tierra del Fuego',

  // Tucumán
  'tucuman': 'Tucumán',
}

// Ordenamos las keys por longitud descendente una sola vez para el fallback por substring.
const ALIAS_KEYS_BY_LENGTH = Object.keys(ALIASES).sort((a, b) => b.length - a.length)

/**
 * Resuelve un label libre (lo que el usuario tipeó / lo que vino del OCR)
 * al nombre canónico de jurisdicción IIBB que espera Colppy.
 *
 * Estrategia:
 *   1. Match exacto (normalizado)
 *   2. Longest-substring: busca el alias más largo contenido en el label
 *      → permite matchear "IB Bs As", "PERCEP. AGIP", "IIBB Córdoba", etc.
 *
 * @returns nombre canónico o `null` si no matchea ninguna jurisdicción conocida
 */
export function resolveJurisdiccionIIBB(label: string): JurisdiccionIIBB | null {
  const norm = normalize(label)
  if (!norm) return null

  // 1) Match exacto (el label normalizado ES un alias conocido)
  if (ALIASES[norm]) return ALIASES[norm]

  // 2) Longest-substring: el label contiene un alias conocido
  for (const key of ALIAS_KEYS_BY_LENGTH) {
    // Usamos boundaries de espacio para evitar falsos positivos
    // (ej. "la pampa" dentro de "la pampanita" — improbable pero seguro)
    if (norm === key || norm.startsWith(key + ' ') || norm.endsWith(' ' + key) || norm.includes(' ' + key + ' ')) {
      return ALIASES[key]
    }
  }

  return null
}

/**
 * Versión estricta: lanza un Error con un mensaje claro listando las
 * jurisdicciones válidas, para usar en validación de API/formularios.
 */
export function resolveJurisdiccionIIBBOrThrow(label: string): JurisdiccionIIBB {
  const result = resolveJurisdiccionIIBB(label)
  if (!result) {
    const raw = (label || '').trim()
    throw new Error(
      `Jurisdicción IIBB no reconocida: "${raw}". ` +
        `Escribila con alguno de estos nombres (o aliases tipo "IB <provincia>", "IIBB <provincia>"): ` +
        COLPPY_JURISDICCIONES.join(', ') +
        '.'
    )
  }
  return result
}

/** `true` si el label ya es una jurisdicción IIBB canónica reconocida. */
export function isJurisdiccionIIBB(label: string): label is JurisdiccionIIBB {
  return (COLPPY_JURISDICCIONES as readonly string[]).includes(label)
}

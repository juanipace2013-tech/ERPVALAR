// Kits de bobina + conector para electroválvulas GENEBRE/ODE vendidas "SIN BOBINA".
// Fuente: "CGE_ARG_2024-08-01_ELECTROVALVULAS_L12.pdf" (Listado de Precios/Genebre).
// Con un click se agregan la bobina de la tensión elegida + el conector como
// adicionales del item (mismo patrón que los conjuntos armados de actuadores).
//
// Reglas de la lista GENEBRE:
// - Bobina estándar 8W: Art. 4808 (11/22/24 AC, C12/C24 DC).
// - 4010 06 (1"): la bobina debe ser SIEMPRE de 14W → Art. 4814 (nota 2, pág. 1).
// - 4010 / 4010V / 4631 con corriente continua: bobina de 14W → Art. 4814 C12/C24 (nota 1).
// - Conector tripolar 4801 08 para todos los kits, incluso bobinas 14W
//   (definido por Santiago 2026-08-12; el listado solo trae conector 5W y 8W).
// - Solo bobinas estándar 4808/4814: las clase H 180ºC (4808F) se cargan a mano
//   cuando hacen falta (definido por Santiago 2026-08-12).
// Las válvulas "COMPLETA" (4030, 4040, 4210, 4330, etc.) ya incluyen bobina y
// no llevan kit.

export type TensionBobina = '220V AC' | '110V AC' | '24V AC' | '12V DC' | '24V DC'

export interface BobinaKit {
  tension: TensionBobina
  bobinaSku: string
  conectorSku: string
  nota?: string
}

const CONECTOR_SKU = '4801 08'

type FamiliaBobina = '4808' | '4814'

// Sufijo de SKU de bobina por tensión (igual para 4808 y 4814)
const SUFIJO_TENSION: Record<TensionBobina, string> = {
  '220V AC': '22',
  '110V AC': '11',
  '24V AC': '24',
  '12V DC': 'C12',
  '24V DC': 'C24',
}

const TENSIONES_AC: TensionBobina[] = ['220V AC', '110V AC', '24V AC']
const TENSIONES_DC: TensionBobina[] = ['12V DC', '24V DC']

interface ReglaSerie {
  medidas: string[]
  ac: FamiliaBobina
  dc: FamiliaBobina
  notaDC?: string
  // Overrides por medida (ej: 4010 06 siempre 14W)
  overrides?: Record<string, { ac: FamiliaBobina; dc: FamiliaBobina; notaDC?: string }>
}

const NOTA_DC_6BAR =
  'Con bobina de corriente continua la presión máxima de operación baja a 6 Bar (tabla GENEBRE).'

const SERIES: Record<string, ReglaSerie> = {
  // ── Normal cerrada ──
  // Medidas 03-06 = Art. 4010 (NBR); 07-08 = Art. 4010V (Vitón) — en el
  // catálogo ambas viven bajo el SKU "4010 XX" sin la V.
  '4010': {
    medidas: ['03', '04', '05', '06', '07', '08'],
    ac: '4808',
    dc: '4814',
    overrides: {
      '06': { ac: '4814', dc: '4814', notaDC: NOTA_DC_6BAR }, // 1": siempre 14W
      '07': { ac: '4808', dc: '4814', notaDC: NOTA_DC_6BAR },
      '08': { ac: '4808', dc: '4814', notaDC: NOTA_DC_6BAR },
    },
  },
  '4020': { medidas: ['03', '04', '05', '06', '07', '08', '09'], ac: '4808', dc: '4808' },
  '4020V': { medidas: ['03', '04', '05', '06', '07', '08', '09'], ac: '4808', dc: '4808' },
  '4020E': { medidas: ['05', '06', '07', '08', '09'], ac: '4808', dc: '4808' },
  '4630': {
    medidas: ['02'],
    ac: '4808',
    dc: '4808',
    notaDC:
      'Con bobina de corriente continua 8W la presión máxima baja a 6 Bar (con 14W llega a 20 Bar — cotizar aparte, tabla GENEBRE).',
  },
  '4631': { medidas: ['04', '05', '06'], ac: '4808', dc: '4814' },
  '4632': { medidas: ['04', '05', '06'], ac: '4808', dc: '4808' },
  '46303': { medidas: ['02'], ac: '4808', dc: '4808' },
  // ── Normal abierta ──
  '4021': { medidas: ['03', '04', '05', '06', '07', '08', '09'], ac: '4808', dc: '4808' },
  '4021V': { medidas: ['03', '04', '05', '06', '07', '08', '09'], ac: '4808', dc: '4808' },
  '4021E': { medidas: ['05', '06', '07', '08', '09'], ac: '4808', dc: '4808' },
  '4640': { medidas: ['02'], ac: '4808', dc: '4808', notaDC: NOTA_DC_6BAR },
  '4642': { medidas: ['04', '05', '06'], ac: '4808', dc: '4808' },
}

const KITS_POR_SKU = new Map<string, BobinaKit[]>()
for (const [serie, regla] of Object.entries(SERIES)) {
  for (const medida of regla.medidas) {
    const efectiva = regla.overrides?.[medida] ?? regla
    const kits: BobinaKit[] = [
      ...TENSIONES_AC.map((tension) => ({
        tension,
        bobinaSku: `${efectiva.ac} ${SUFIJO_TENSION[tension]}`,
        conectorSku: CONECTOR_SKU,
      })),
      ...TENSIONES_DC.map((tension) => ({
        tension,
        bobinaSku: `${efectiva.dc} ${SUFIJO_TENSION[tension]}`,
        conectorSku: CONECTOR_SKU,
        ...(efectiva.notaDC ? { nota: efectiva.notaDC } : {}),
      })),
    ]
    KITS_POR_SKU.set(`${serie} ${medida}`, kits)
  }
}

// Devuelve los kits bobina+conector disponibles para un SKU de electroválvula
// sin bobina (vacío si el SKU no corresponde a una de estas series)
export function getBobinasElectrovalvula(sku: string): BobinaKit[] {
  return KITS_POR_SKU.get(sku.trim()) ?? []
}

// ── Electroválvula NAMUR (Art. 4519) para actuadores neumáticos ─────────────
// Al armar un conjunto neumático (simple o doble efecto) se ofrece agregar la
// electroválvula NAMUR 5/2 y 3/2 vías en la tensión elegida. Bobina incluida.
// Fuente: mismo listado GENEBRE de electroválvulas (Art. 4519).

export interface NamurKit {
  tension: TensionBobina
  sku: string
}

// El sufijo de tensión del 4519 no coincide con el de las bobinas 4808/4814
// (usa "220"/"110" completos en AC).
const SUFIJO_TENSION_NAMUR: Record<TensionBobina, string> = {
  '220V AC': '220',
  '110V AC': '110',
  '24V AC': '24',
  '12V DC': 'C12',
  '24V DC': 'C24',
}

export const ELECTROVALVULAS_NAMUR: NamurKit[] = [...TENSIONES_AC, ...TENSIONES_DC].map(
  (tension) => ({ tension, sku: `4519 02 ${SUFIJO_TENSION_NAMUR[tension]}` })
)

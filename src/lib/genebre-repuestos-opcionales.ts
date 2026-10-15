// Opcionales de asiento/juntas para válvulas GENEBRE (kit vapor, asiento Viton).
// Fuente: "GE_ARG_2024-08-01_INDUSTRIAL_REPUESTOS_L14.pdf" (Listado de Precios/Genebre)
// y los SKUs cargados en el catálogo.
// Con un click se agrega el repuesto de la medida de la válvula como adicional
// del item (mismo patrón que los conjuntos armados de actuadores).
//
// - Kit vapor esféricas 2025 / 2025N / 2026 / 2027 → Art. 2820C (juntas y
//   asientos PTFE + 25% grafito).
// - Kit vapor esféricas 2034 / 2034N / 2034S → Art. 2838C (PTFE + 25% grafito).
//   El 2838C 02 cubre 1/4" y 3/8" (no existe 2838C 03).
// - Asiento Viton mariposa 2109 → Art. EV2109 (elastómero Viton, 2" a 12").
//   La lista no trae elastómero Viton para otras mariposas (2104, 2108A, 2101).

export interface RepuestoOpcion {
  sku: string
  label: string
}

interface ReglaSerie {
  label: string
  articulo: string
  medidas: string[]
  // Medida de la válvula → medida del repuesto cuando no coinciden
  equivalencias?: Record<string, string>
}

const KIT_VAPOR = 'Kit vapor (PTFE + 25% grafito)'
const ASIENTO_VITON = 'Asiento Viton'

const KIT_VAPOR_2025: ReglaSerie = {
  label: KIT_VAPOR,
  articulo: '2820C',
  medidas: ['02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
}

const KIT_VAPOR_2034: ReglaSerie = {
  label: KIT_VAPOR,
  articulo: '2838C',
  medidas: ['02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
  equivalencias: { '03': '02' },
}

const ASIENTO_VITON_2109: ReglaSerie = {
  label: ASIENTO_VITON,
  articulo: 'EV2109',
  medidas: ['09', '10', '11', '12', '13', '14', '16', '18', '20'],
}

// Serie de la válvula (primer tramo del SKU, ej: "2025 04" → "2025")
const SERIES: Record<string, ReglaSerie[]> = {
  '2025': [KIT_VAPOR_2025],
  '2025N': [KIT_VAPOR_2025],
  '2026': [KIT_VAPOR_2025],
  '2027': [KIT_VAPOR_2025],
  '2034': [KIT_VAPOR_2034],
  '2034N': [KIT_VAPOR_2034],
  '2034S': [KIT_VAPOR_2034],
  '2109': [ASIENTO_VITON_2109],
}

// Devuelve los repuestos opcionales que se pueden ofrecer para un SKU de
// válvula (vacío si la serie o la medida no tienen opcional)
export function getRepuestosOpcionales(sku: string): RepuestoOpcion[] {
  const [serie, medida] = sku.trim().split(/\s+/)
  const reglas = SERIES[serie]
  if (!reglas || !medida) return []
  return reglas
    .filter((regla) => regla.medidas.includes(medida))
    .map((regla) => ({
      sku: `${regla.articulo} ${regla.equivalencias?.[medida] ?? medida}`,
      label: regla.label,
    }))
}

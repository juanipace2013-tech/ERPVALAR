/**
 * Fuente única de verdad para el mapeo de `idCondicionIva` de Colppy →
 * enum `TaxCondition` del schema local + string de display para UI.
 *
 * Verificado empíricamente contra la API de Colppy (abril 2026):
 *   '1' = Responsable Inscripto (mayoría de B2B)
 *   '2' = Exento (organismos públicos, mutuales, asociaciones)
 *   '3' = Consumidor Final (consorcios, particulares sin facturación A)
 *   '4' = Monotributo (particulares con CUIT personal)
 *   '6' = Responsable No Inscripto (legacy, casi sin uso)
 *
 * IMPORTANTE: no existen en Colppy los IDs '5' ni '7+' para esta cuenta.
 *
 * Este archivo centraliza el mapeo para que no se dupliquen copias con
 * inconsistencias (bug histórico: IDs 2 y 4 invertidos, ID 3 ausente).
 * Usar SIEMPRE `mapColppyTaxCondition()` en los call sites.
 */

import { logger } from '@/lib/logger'

export const COLPPY_TAX_CONDITION_MAP: Record<string, string> = {
  '1': 'RESPONSABLE_INSCRIPTO',
  '2': 'EXENTO',
  '3': 'CONSUMIDOR_FINAL',
  '4': 'MONOTRIBUTO',
  '6': 'RESPONSABLE_NO_INSCRIPTO',
}

export const COLPPY_TAX_CONDITION_DISPLAY: Record<string, string> = {
  '1': 'Resp. Inscripto',
  '2': 'Exento',
  '3': 'Consumidor Final',
  '4': 'Monotributo',
  '6': 'Resp. No Inscripto',
}

/**
 * Fallback seguro cuando el ID no está mapeado: CONSUMIDOR_FINAL emite
 * Factura B (IVA incluido). El error de asignar Factura B a un RI tiene
 * menor costo fiscal que al revés, así que es el default menos riesgoso.
 */
export const DEFAULT_TAX_CONDITION = 'CONSUMIDOR_FINAL'
export const DEFAULT_TAX_CONDITION_DISPLAY = 'Consumidor Final'

export interface MappedTaxCondition {
  /** Enum TaxCondition del schema Prisma. Siempre definido (usa fallback si el ID es desconocido). */
  taxCondition: string
  /** String para mostrar en la UI. */
  display: string
  /** true si el idCondicionIva no estaba en el mapa (se usó fallback). */
  isUnknown: boolean
}

/**
 * Traduce un `idCondicionIva` de Colppy a la TaxCondition del schema.
 * Si el ID es desconocido:
 *   - Devuelve `DEFAULT_TAX_CONDITION` (CONSUMIDOR_FINAL).
 *   - Loguea warning con contexto para revisión manual.
 *   - Marca `isUnknown: true` por si el caller quiere reaccionar distinto.
 *
 * @param rawId   `idCondicionIva` tal como viene de Colppy (puede ser
 *                number, string, null, undefined — todo se normaliza a string).
 * @param context Dato opcional para enriquecer el log de IDs desconocidos
 *                (ej: "CUIT 30-12345678-9 - ACME SA").
 */
export function mapColppyTaxCondition(
  rawId: unknown,
  context?: string
): MappedTaxCondition {
  const id = String(rawId ?? '')
  const taxCondition = COLPPY_TAX_CONDITION_MAP[id]
  const display = COLPPY_TAX_CONDITION_DISPLAY[id]

  if (!taxCondition) {
    logger.warn(
      `[Colppy] idCondicionIva desconocido: "${id}"` +
        (context ? ` — ${context}` : '') +
        ` — fallback a ${DEFAULT_TAX_CONDITION}`
    )
    return {
      taxCondition: DEFAULT_TAX_CONDITION,
      display: DEFAULT_TAX_CONDITION_DISPLAY,
      isUnknown: true,
    }
  }

  return { taxCondition, display, isUnknown: false }
}

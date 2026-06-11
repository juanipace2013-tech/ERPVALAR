/**
 * Mapping de tipo de retención → código de cuenta contable
 *
 * Todas las jurisdicciones IIBB van a la cuenta 114301.
 * La discriminación por jurisdicción queda registrada en
 * ReceiptWithholdingLine.jurisdictionLabel y .withholdingType,
 * pero el asiento contable las agrupa en una sola línea por cuenta.
 *
 * Cuentas reales del plan de cuentas:
 *   114101 - Ret Sufridas Imp Ganancias
 *   114105 - IVA Retenciones
 *   114301 - Ret y Percepciones Imp IIBB
 *   213201 - Retenciones Sufridas SUSS
 *   113100 - Deudores Por Ventas (HABER al cobrar)
 */

export const WITHHOLDING_ACCOUNT_MAPPING: Record<string, string> = {
  // IIBB — todas las jurisdicciones van a la misma cuenta
  IIBB_CABA:         '114301',
  IIBB_BUENOS_AIRES: '114301',
  IIBB_CORDOBA:      '114301',
  IIBB_SANTA_FE:     '114301',
  IIBB_MENDOZA:      '114301',
  IIBB_TUCUMAN:      '114301',
  IIBB_SALTA:        '114301',
  IIBB_ENTRE_RIOS:   '114301',
  IIBB_OTRAS:        '114301',
  // Otras retenciones
  IVA:               '114105',
  GANANCIAS:         '114101',
  SUSS:              '213201',
}

/** Cuenta Deudores por Ventas — HABER en asiento REC */
export const ACCOUNTS_RECEIVABLE_CODE = '113100'

/** Jurisdicciones IIBB disponibles para el formulario */
export const IIBB_JURISDICTIONS = [
  { value: 'IIBB_CABA',         label: 'CABA' },
  { value: 'IIBB_BUENOS_AIRES', label: 'Buenos Aires' },
  { value: 'IIBB_CORDOBA',      label: 'Córdoba' },
  { value: 'IIBB_SANTA_FE',     label: 'Santa Fe' },
  { value: 'IIBB_MENDOZA',      label: 'Mendoza' },
  { value: 'IIBB_TUCUMAN',      label: 'Tucumán' },
  { value: 'IIBB_SALTA',        label: 'Salta' },
  { value: 'IIBB_ENTRE_RIOS',   label: 'Entre Ríos' },
  { value: 'IIBB_OTRAS',        label: 'Otras Provincias' },
] as const

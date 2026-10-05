/**
 * Normaliza un CUIT al formato estándar XX-XXXXXXXX-X
 * Acepta cualquier formato: "30612406614", "30-61240661-4", "30 61240661 4"
 * Retorna null si el CUIT no es válido (no tiene 11 dígitos)
 */
export function normalizeCuit(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 11) return null
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
}

/**
 * Busca un cliente por CUIT, probando tanto el formato con guiones como sin guiones
 * para manejar datos legacy que pueden estar en cualquier formato.
 */
export function buildCuitWhereClause(cuit: string) {
  const digits = cuit.replace(/\D/g, '')
  const formatted = `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
  return {
    OR: [
      { cuit: formatted },
      { cuit: digits },
    ]
  }
}

/** Pesos del dígito verificador de CUIT/CUIL (módulo 11). */
const PESOS_CUIT = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

/**
 * Dígito verificador de los 10 primeros dígitos de un CUIT/CUIL (algoritmo
 * estándar módulo 11). null si da 10: ARCA no usa esa combinación (pasa al
 * prefijo 23 en las personas, 33 en las sociedades).
 */
export function digitoVerificadorCuit(base10: string): number | null {
  if (!/^\d{10}$/.test(base10)) return null
  const resto = PESOS_CUIT.reduce((s, p, i) => s + p * Number(base10[i]), 0) % 11
  if (resto === 0) return 0
  return resto === 1 ? null : 11 - resto
}

/**
 * CUIT/CUIL con el dígito verificador correcto. Estricto: a diferencia de
 * validateCUIT (src/lib/utils.ts) no acepta el resto 1 como 9.
 */
export function esCuitValido(raw: string | null | undefined): boolean {
  const d = (raw ?? '').replace(/\D/g, '')
  if (d.length !== 11) return false
  return digitoVerificadorCuit(d.slice(0, 10)) === Number(d[10])
}

/**
 * CUIL posibles de una persona a partir de su DNI (11 dígitos, sin guiones),
 * del más probable al menos: 20 (varón), 27 (mujer), 23 (cuando 20/27 darían
 * dígito 10) y 24 (DNI repetidos). Se descartan los prefijos cuyo dígito da 10.
 * Son solo candidatos: hay que confirmarlos con el padrón de ARCA.
 */
export function cuilsCandidatosDesdeDni(dni: string | number | null | undefined): string[] {
  const d = String(dni ?? '').replace(/\D/g, '')
  if (d.length < 7 || d.length > 8) return []
  const base = d.padStart(8, '0')
  const out: string[] = []
  for (const prefijo of ['20', '27', '23', '24']) {
    const dv = digitoVerificadorCuit(prefijo + base)
    if (dv !== null) out.push(`${prefijo}${base}${dv}`)
  }
  return out
}

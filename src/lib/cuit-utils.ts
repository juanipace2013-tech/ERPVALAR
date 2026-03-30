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

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ========================================
// UTILIDADES ARGENTINAS
// ========================================

/**
 * Valida un CUIT/CUIL argentino usando el algoritmo de dígito verificador
 */
export function validateCUIT(cuit: string): boolean {
  // Remover guiones y espacios
  const cleanCuit = cuit.replace(/[-\s]/g, '')

  // Verificar que tenga 11 dígitos
  if (!/^\d{11}$/.test(cleanCuit)) {
    return false
  }

  // Algoritmo de validación del dígito verificador
  const multiplicadores = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const digits = cleanCuit.split('').map(Number)
  const verificador = digits[10]

  let suma = 0
  for (let i = 0; i < 10; i++) {
    suma += digits[i] * multiplicadores[i]
  }

  const resto = suma % 11
  const digitoCalculado = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto

  return digitoCalculado === verificador
}

/**
 * Formatea un CUIT en formato XX-XXXXXXXX-X
 */
export function formatCUIT(cuit: string): string {
  const cleanCuit = cuit.replace(/[-\s]/g, '')
  if (cleanCuit.length !== 11) return cuit
  return `${cleanCuit.slice(0, 2)}-${cleanCuit.slice(2, 10)}-${cleanCuit.slice(10)}`
}

/**
 * Formatea un número con formato argentino (punto miles, coma decimales)
 * Ejemplo: formatNumber(2359.43) → "2.359,43"
 */
export function formatNumber(
  amount: number | string,
  decimals: number = 2
): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return num.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Formatea un monto como moneda con formato argentino (punto miles, coma decimales).
 * Acepta number o string (los Decimal de Prisma llegan como string vía JSON).
 * Ejemplos: formatCurrency(3590, 'USD') → "USD 3.590,00"
 *           formatCurrency(19758900, 'ARS') → "$19.758.900,00"
 */
export function formatCurrency(
  amount: number | string,
  currency: 'ARS' | 'USD' | 'EUR' = 'ARS'
): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  const formatted = (Number.isFinite(num) ? num : 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return currency === 'ARS' ? `$${formatted}` : `${currency} ${formatted}`
}

/**
 * Formatea una fecha en formato argentino DD/MM/YYYY
 */
export function formatDateAR(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/**
 * Formatea una fecha y hora en formato argentino
 */
export function formatDateTimeAR(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Devuelve la fecha local actual en formato YYYY-MM-DD (respeta timezone del browser) */
export function getLocalDateString(date?: Date): string {
  const d = date || new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Capitaliza la primera letra de cada palabra
 */
export function capitalize(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

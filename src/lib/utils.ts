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
 * Formatea un número como moneda argentina
 * Ejemplo: formatCurrency(2359.43, 'USD') → "USD 2.359,43"
 */
export function formatCurrency(
  amount: number | string,
  currency: 'ARS' | 'USD' | 'EUR' = 'ARS'
): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount

  const currencySymbols = {
    ARS: 'ARS',
    USD: 'USD',
    EUR: 'EUR',
  }

  return `${currencySymbols[currency]} ${num.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Formatea una fecha en formato argentino DD/MM/YYYY
 */
export function formatDateAR(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/**
 * Formatea una fecha y hora en formato argentino
 */
export function formatDateTimeAR(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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

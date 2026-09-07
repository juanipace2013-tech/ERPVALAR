/**
 * Parseo defensivo de page/limit de query strings.
 * Evita NaN, negativos y limits gigantes que traen tablas enteras.
 */
export const MAX_PAGE_LIMIT = 200

export function parsePage(raw: string | null | undefined): number {
  const n = parseInt(raw || '1', 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

export function parseLimit(raw: string | null | undefined, defaultLimit: number, max = MAX_PAGE_LIMIT): number {
  const n = parseInt(raw || String(defaultLimit), 10)
  if (!Number.isFinite(n) || n < 1) return defaultLimit
  return Math.min(n, max)
}

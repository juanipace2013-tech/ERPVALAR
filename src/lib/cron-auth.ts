import { createHash, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

/**
 * Secreto de los endpoints /api/cron/*.
 *
 * Se acepta por encabezado `Authorization: Bearer <CRON_SECRET>` (preferido:
 * no queda en los logs de acceso de nginx) o por `?secret=` (compatibilidad
 * con las líneas del crontab que todavía lo mandan en la URL).
 */
export function cronSecretFromRequest(req: NextRequest): string | null {
  const header = req.headers.get('authorization') || ''
  if (header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim()
    if (token) return token
  }
  return req.nextUrl.searchParams.get('secret')
}

/** Compara contra CRON_SECRET en tiempo constante. Sin CRON_SECRET, nunca es válido. */
export function isCronSecretValid(secret: string | null | undefined): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected || !secret) return false
  // Se hashea antes de comparar para igualar longitudes (timingSafeEqual lo exige).
  const a = createHash('sha256').update(secret).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

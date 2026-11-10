import { prisma } from '@/lib/prisma'

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutos

/**
 * Devuelve true si el key puede intentar, false si está bloqueado.
 */
export async function checkRateLimit(key: string, max: number = MAX_ATTEMPTS): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS)
  const count = await prisma.authAttempt.count({
    where: { key, createdAt: { gte: since } },
  })
  return count < max
}

/**
 * Registra un intento fallido.
 */
export async function recordFailedAttempt(key: string): Promise<void> {
  await prisma.authAttempt.create({ data: { key } })
}

/**
 * Limpia intentos de un key (llamar tras login exitoso).
 */
export async function clearAttempts(key: string): Promise<void> {
  await prisma.authAttempt.deleteMany({ where: { key } })
}

/**
 * Purga registros más viejos que el window (para cron/cleanup opcional).
 */
export async function purgeOldAttempts(): Promise<number> {
  const cutoff = new Date(Date.now() - WINDOW_MS)
  const result = await prisma.authAttempt.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })
  return result.count
}

/**
 * Servicio para obtener datos del Banco Central de la República Argentina (BCRA)
 */

import axios from 'axios'
import https from 'https'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'

interface BCRAMoneda {
  codigoMoneda: string
  descripcion: string
  tipoPase: number
  tipoCotizacion: number
}

interface BCRACotizacionResponse {
  status: number
  results: {
    fecha: string
    detalle: BCRAMoneda[]
  }
}

// Agente HTTPS que ignora errores de certificado SSL
// Necesario porque el certificado del BCRA puede tener problemas de verificación
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
})

// Cliente axios configurado para BCRA
const bcraClient = axios.create({
  httpsAgent,
  headers: {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  },
  timeout: 10000, // 10 segundos
})

// ──────────────────────────────────────────────────────────────────────────
// Caché stale-while-error del dólar BCRA
//
// El dólar oficial cambia ~1 vez/día, pero antes se consultaba en vivo en cada
// request: cuando el BCRA tardaba o fallaba, rompía el flujo de cotización.
// Reutilizamos el modelo BcraCache (mismo patrón que el padrón CUIT) con un
// `cuit` centinela y `consultedAt` como timestamp de TTL. Así el equipo casi
// nunca ve un error: si el BCRA falla, devolvemos el último valor conocido.
// ──────────────────────────────────────────────────────────────────────────

/** Clave centinela en BcraCache para el dólar oficial (cuit es @unique). */
const USD_RATE_CACHE_KEY = '__USD_RATE__'
/** Considerar fresco el valor cacheado dentro de esta ventana. */
const USD_RATE_TTL_MS = 45 * 60 * 1000 // 45 minutos
/** Corte por intento de red para no quedar colgados. */
const FETCH_TIMEOUT_MS = 6000
/** Cantidad máxima de intentos contra el BCRA. */
const MAX_FETCH_ATTEMPTS = 3
/** Backoff exponencial entre intentos (ms). */
const FETCH_BACKOFF_MS = [500, 1000, 2000]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type UsdRateValue = { rate: number; date: Date; source: string }
type CachedUsdRate = UsdRateValue & { consultedAt: Date }

/** Lee el último dólar guardado en BcraCache (sin importar si está vencido). */
async function readUsdRateCache(): Promise<CachedUsdRate | null> {
  const cache = await prisma.bcraCache.findUnique({
    where: { cuit: USD_RATE_CACHE_KEY },
  })
  if (!cache) return null

  const data = cache.data as { rate?: number; date?: string; source?: string }
  if (typeof data?.rate !== 'number') return null

  return {
    rate: data.rate,
    date: data.date ? new Date(data.date) : new Date(cache.consultedAt),
    source: data.source ?? 'BANCO_CENTRAL',
    consultedAt: new Date(cache.consultedAt),
  }
}

/** Persiste el dólar fresco en BcraCache, refrescando consultedAt para el TTL. */
async function writeUsdRateCache(value: UsdRateValue): Promise<void> {
  const data = {
    rate: value.rate,
    date: value.date.toISOString(),
    source: value.source,
  }
  await prisma.bcraCache.upsert({
    where: { cuit: USD_RATE_CACHE_KEY },
    create: { cuit: USD_RATE_CACHE_KEY, data, consultedAt: new Date() },
    update: { data, consultedAt: new Date() },
  })
}

/**
 * Llama al BCRA con timeout por intento (AbortController) y reintentos con
 * backoff exponencial. Lanza si todos los intentos fallan.
 */
async function fetchUsdRateFromBCRA(): Promise<UsdRateValue> {
  // API del BCRA v1 - Cotizaciones (endpoint sin cambios; solo robustez)
  const url = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones'
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const abortTimer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      logger.info(`📊 Consultando BCRA (intento ${attempt}/${MAX_FETCH_ATTEMPTS}):`, url)

      const response = await bcraClient.get<BCRACotizacionResponse>(url, {
        signal: controller.signal,
        timeout: FETCH_TIMEOUT_MS,
      })

      const data = response.data

      if (!data.results || !data.results.detalle) {
        throw new Error('No hay datos disponibles del BCRA')
      }

      const usdData = data.results.detalle.find(
        (moneda) => moneda.codigoMoneda === 'USD'
      )

      if (!usdData || !usdData.tipoCotizacion) {
        throw new Error('No se encontró cotización USD en los datos del BCRA')
      }

      logger.info('✅ Tipo de cambio BCRA obtenido:', {
        fecha: data.results.fecha,
        moneda: usdData.descripcion,
        tipoCotizacion: usdData.tipoCotizacion,
      })

      return {
        rate: usdData.tipoCotizacion,
        date: new Date(data.results.fecha),
        source: 'BANCO_CENTRAL',
      }
    } catch (error) {
      lastError = error
      logger.warn(
        `[BCRA] Falló intento ${attempt}/${MAX_FETCH_ATTEMPTS}:`,
        error instanceof Error ? error.message : error
      )
      if (attempt < MAX_FETCH_ATTEMPTS) {
        await sleep(FETCH_BACKOFF_MS[attempt - 1] ?? 2000)
      }
    } finally {
      clearTimeout(abortTimer)
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Error desconocido al consultar BCRA')
}

/**
 * Obtiene el tipo de cambio USD oficial del BCRA con estrategia
 * stale-while-error:
 *  1. Si hay un valor en caché dentro del TTL (45 min), se devuelve sin red.
 *  2. Si está vencido o no existe, se consulta el BCRA (6s timeout, 3 intentos).
 *  3. Si responde OK: se actualiza la caché y se devuelve el valor fresco.
 *  4. Si falla tras los reintentos: se devuelve el último valor cacheado
 *     (aunque esté vencido) con `stale: true` y un warning estructurado.
 *  5. Solo se lanza error si la caché está completamente vacía.
 */
export async function getBCRAUSDRate(): Promise<{
  rate: number
  date: Date
  source: string
  stale: boolean
}> {
  const cached = await readUsdRateCache()

  // 1. Cache fresco dentro del TTL → no tocar la red.
  if (cached) {
    const age = Date.now() - cached.consultedAt.getTime()
    if (age < USD_RATE_TTL_MS) {
      logger.info(`[BCRA] Cache hit dólar (edad: ${Math.round(age / 60000)} min)`)
      return { rate: cached.rate, date: cached.date, source: cached.source, stale: false }
    }
  }

  // 2-3. Cache vencido o ausente → consultar BCRA con timeout + reintentos.
  try {
    const fresh = await fetchUsdRateFromBCRA()
    await writeUsdRateCache(fresh)
    return { ...fresh, stale: false }
  } catch (error) {
    // 4. BCRA caído → devolver último valor conocido (stale) si existe.
    if (cached) {
      logger.warn('[BCRA] Red caída — devolviendo dólar stale de la caché', {
        rate: cached.rate,
        cachedAt: cached.consultedAt.toISOString(),
        ageMinutes: Math.round((Date.now() - cached.consultedAt.getTime()) / 60000),
        error: error instanceof Error ? error.message : String(error),
      })
      return { rate: cached.rate, date: cached.date, source: cached.source, stale: true }
    }

    // 5. Sin caché previa → no hay nada que devolver, propagar el error.
    logger.error('❌ BCRA caído y sin valor cacheado disponible:', error)
    throw new Error(
      error instanceof Error
        ? `Error BCRA (sin cache disponible): ${error.message}`
        : 'Error desconocido al consultar BCRA (sin cache disponible)'
    )
  }
}

/**
 * Obtiene todas las cotizaciones disponibles del BCRA
 */
export async function getBCRACotizaciones(): Promise<BCRACotizacionResponse> {
  try {
    const url = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones'

    logger.info('📊 Consultando cotizaciones BCRA:', url)

    const response = await bcraClient.get<BCRACotizacionResponse>(url)

    const data = response.data

    logger.info('✅ Cotizaciones BCRA obtenidas:', {
      fecha: data.results.fecha,
      monedas: data.results.detalle.length,
    })

    return data
  } catch (error) {
    logger.error('❌ Error al obtener cotizaciones del BCRA:', error)
    throw new Error(
      error instanceof Error
        ? `Error BCRA: ${error.message}`
        : 'Error desconocido al consultar BCRA'
    )
  }
}

/**
 * Formatea un número como tipo de cambio (6 decimales)
 */
export function formatExchangeRate(rate: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(rate)
}

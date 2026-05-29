import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import { logger } from '@/lib/logger'

const BCRA_BASE = 'https://api.bcra.gob.ar/CentralDeDeudores/v1.0'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 horas — los datos BCRA se actualizan mensualmente
const GLOBAL_COOLDOWN_MS = 10000 // mínimo 10s entre consultas nuevas al BCRA
const FETCH_TIMEOUT_MS = 8000 // corte por intento (AbortController) para no quedar colgados
const MAX_RETRIES = 3 // intentos por endpoint del BCRA
const BACKOFF_BASE_MS = 500 // backoff exponencial: 500ms, 1s, 2s

// ── Rate limit global ────────────────────────────────────────────────────────
let lastBcraCallTime = 0
let queuePromise: Promise<void> = Promise.resolve()

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = queuePromise.then(async () => {
    const now = Date.now()
    const elapsed = now - lastBcraCallTime
    if (elapsed < GLOBAL_COOLDOWN_MS) {
      const wait = GLOBAL_COOLDOWN_MS - elapsed
      logger.info(`[BCRA] Rate limit: esperando ${wait}ms antes de la próxima consulta`)
      await sleep(wait)
    }
  })

  const result = p.then(fn).finally(() => {
    lastBcraCallTime = Date.now()
  })

  queuePromise = result.then(() => {}, () => {})

  return result
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function normalizeCuit(cuit: string): string {
  return cuit.replace(/[-.\s]/g, '').slice(0, 11)
}

function formatCuit(cuit: string): string {
  const c = normalizeCuit(cuit)
  return `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`
}

function calcularSemaforo(
  situacionPeor: number,
  cantidadCheques: number
): 'verde' | 'amarillo' | 'rojo' {
  if (situacionPeor >= 4) return 'rojo'
  if (situacionPeor >= 2 || cantidadCheques > 0) return 'amarillo'
  return 'verde'
}

/**
 * Fetch al BCRA con retry y backoff exponencial.
 * La API devuelve 503 en ~60% de requests individuales,
 * pero con varios intentos se logra alta tasa de éxito.
 * Cada intento tiene timeout propio (AbortController) para no quedar colgado.
 * HTTP 404 = sin datos (no es error).
 */
async function fetchBCRAWithRetry(url: string, maxRetries = MAX_RETRIES): Promise<any> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetch(url, {
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
          cache: 'no-store',
        })
      } finally {
        clearTimeout(timeout)
      }

      // 404 = sin datos, respuesta válida
      if (response.status === 404) {
        logger.info(`[BCRA] ${url} → 404 (sin datos)`)
        return { status: 404, errorMessages: ['Sin información'] }
      }

      if (response.status === 503 || response.status === 502) {
        logger.info(`[BCRA] Intento ${attempt + 1}/${maxRetries} → ${response.status}, reintentando...`)
        if (attempt < maxRetries - 1) await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt))
        continue
      }

      const text = await response.text()
      if (!text) {
        logger.warn(`[BCRA] Respuesta vacía de ${url}`)
        return { status: response.status, errorMessages: ['Respuesta vacía del BCRA'] }
      }

      return JSON.parse(text)
    } catch (error: any) {
      logger.warn(`[BCRA] Intento ${attempt + 1}/${maxRetries} → Error: ${error.message}`)
      if (attempt < maxRetries - 1) {
        await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt))
      }
    }
  }
  throw new Error(`BCRA API no disponible después de ${maxRetries} intentos`)
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ cuit: string }> }
) {
  const { cuit: rawCuit } = await params
  const cuit = normalizeCuit(rawCuit)

  if (cuit.length !== 11 || !/^\d+$/.test(cuit)) {
    return NextResponse.json({ error: 'CUIT inválido' }, { status: 400 })
  }

  const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true'

  // ── Leer cache una sola vez: sirve para el hit fresco y como fallback stale ──
  const cacheRow = await prisma.bcraCache.findUnique({ where: { cuit } })

  /**
   * Stale-while-error: si el BCRA está caído, devolvemos el último valor
   * cacheado de este CUIT aunque esté vencido (marcado stale). Solo erramos
   * si no hay NADA cacheado para el CUIT (los datos del BCRA cambian ~1 vez
   * por mes, así que un valor viejo sigue siendo útil).
   */
  function staleFallback(reason: string, error?: unknown): NextResponse {
    const cached = cacheRow?.data as any
    if (cached?.resumen && cached?.deudas) {
      const ageH = Math.round(
        (Date.now() - new Date(cacheRow!.consultedAt).getTime()) / 3600000
      )
      logger.warn(`[BCRA] ${reason} — devolviendo valor stale de cache para ${cuit}`, {
        cachedAt: new Date(cacheRow!.consultedAt).toISOString(),
        ageHours: ageH,
        error: error instanceof Error ? error.message : error ? String(error) : undefined,
      })
      return NextResponse.json({ ...cached, stale: true })
    }
    logger.error(`[BCRA] ${reason} y sin cache disponible para ${cuit}`, error ?? '')
    return NextResponse.json(
      {
        error:
          'La API del BCRA no responde momentáneamente y no hay datos previos en cache. Intentá de nuevo.',
      },
      { status: 503 }
    )
  }

  // ── Cache 24h: hit fresco ──
  if (!forceRefresh && cacheRow) {
    const age = Date.now() - new Date(cacheRow.consultedAt).getTime()
    if (age < CACHE_TTL_MS) {
      const cached = cacheRow.data as any
      if (cached?.resumen && cached?.deudas) {
        logger.info(`[BCRA] Cache hit for ${cuit} (age: ${Math.round(age / 3600000)}h)`)
        return NextResponse.json({ ...cached, stale: false })
      }
      logger.warn(`[BCRA] Cache invalid for ${cuit}, refetching...`)
    }
  } else if (forceRefresh) {
    logger.info(`[BCRA] Force refresh for ${cuit}`)
  }

  // ── Fetch 3 endpoints con retry (vía cola global) ──
  let deudas: any
  let historicas: any
  let cheques: any

  try {
    ;({ deudas, historicas, cheques } = await enqueue(async () => {
      const d = await fetchBCRAWithRetry(`${BCRA_BASE}/Deudas/${cuit}`)
      const h = await fetchBCRAWithRetry(`${BCRA_BASE}/Deudas/Historicas/${cuit}`)
      const c = await fetchBCRAWithRetry(`${BCRA_BASE}/Deudas/ChequesRechazados/${cuit}`)
      return { deudas: d, historicas: h, cheques: c }
    }))
  } catch (error) {
    return staleFallback('Error después de reintentos', error)
  }

  // ── Verificar si todas las llamadas fallaron ──
  const allFailed =
    deudas?.status >= 400 &&
    historicas?.status >= 400 &&
    cheques?.status >= 400

  if (allFailed) {
    // Si todas son 404, no es error: simplemente no hay datos
    const all404 =
      deudas?.status === 404 &&
      historicas?.status === 404 &&
      cheques?.status === 404

    if (!all404) {
      return staleFallback('Todas las llamadas fallaron')
    }
  }

  // ── Deudas: extraer entidades del período más reciente ──
  const periodos: any[] =
    deudas?.status === 200 ? (deudas?.results?.periodos ?? []) : []

  const periodosOrdenados = [...periodos].sort((a, b) =>
    a.periodo.localeCompare(b.periodo)
  )
  const periodoActual = periodosOrdenados[periodosOrdenados.length - 1]
  const entidadesRaw: any[] = periodoActual?.entidades ?? []

  logger.info(
    `[BCRA] Periodo actual=${periodoActual?.periodo}, entidades=${entidadesRaw.length}`
  )

  const entidadesMapped = entidadesRaw.map((e: any) => ({
    entidad: typeof e.entidad === 'number' ? e.entidad : 0,
    entidadNombre: typeof e.entidad === 'string' ? e.entidad : undefined,
    situacion: e.situacion,
    monto: e.monto,
    diasAtrasoPago: e.diasAtrasoPago === 'N/A' ? null : e.diasAtrasoPago,
    refinanciaciones: e.refinanciaciones,
    recategorizacionObligacion: e.recategorizacionOblig,
    situacionJuridica: e.situacionJuridica,
    procesoJudicial: e.procesoJud,
  }))

  const situacionPeor =
    entidadesMapped.length > 0
      ? Math.max(...entidadesMapped.map((e: any) => Number(e.situacion) || 1))
      : 0

  const montoTotalDeuda = entidadesMapped.reduce(
    (sum: number, e: any) => sum + (Number(e.monto) || 0),
    0
  )

  // ── Cheques rechazados ──
  const causalesRaw: any[] =
    cheques?.status === 200 ? (cheques?.results?.causales ?? []) : []

  let cantidadChequesRechazados = 0
  for (const causal of causalesRaw) {
    for (const ent of causal.entidades ?? []) {
      cantidadChequesRechazados += (ent.detalle ?? []).length
    }
  }

  const causalesTransformed = causalesRaw.map((c: any) => ({
    descripcionCausal: c.causal ?? '',
    entidades: (c.entidades ?? []).flatMap((ent: any) =>
      (ent.detalle ?? []).map((d: any) => ({
        entidad: typeof ent.entidad === 'number' ? ent.entidad : 0,
        entidadNombre:
          typeof ent.entidad === 'string'
            ? ent.entidad
            : ent.denomJuridica ?? undefined,
        numeroCheque: String(d.nroCheque ?? ''),
        fechaRechazo: d.fechaRechazo ?? null,
        monto: d.monto ?? null,
        moneda: 'ARS',
        pagado: d.fechaPago != null,
        fechaPago: d.fechaPago ?? null,
      }))
    ),
  }))

  // ── Semáforo ──
  const semaforo =
    situacionPeor === 0 && cantidadChequesRechazados === 0
      ? 'verde'
      : calcularSemaforo(situacionPeor, cantidadChequesRechazados)

  const denominacion =
    deudas?.results?.denominacion ||
    historicas?.results?.denominacion ||
    cheques?.results?.denominacion ||
    ''

  // ── Construir respuesta ──
  const deudasTransformed =
    deudas?.status === 200
      ? {
          status: deudas.status,
          results: {
            denominacion: deudas.results?.denominacion,
            periodoInformacion: periodoActual?.periodo,
            entidades: entidadesMapped,
          },
        }
      : deudas

  const chequesTransformed =
    cheques?.status === 200
      ? {
          status: cheques.status,
          results: {
            denominacion: cheques.results?.denominacion,
            causales: causalesTransformed,
          },
        }
      : cheques

  const result = {
    cuit: formatCuit(cuit),
    denominacion,
    deudas: deudasTransformed,
    historicas,
    cheques: chequesTransformed,
    resumen: {
      situacionPeor,
      montoTotalDeuda,
      cantidadEntidades: entidadesMapped.length,
      cantidadChequesRechazados,
      semaforo,
    },
  }

  logger.info(
    `[BCRA] Result: semaforo=${semaforo}, deuda=$${montoTotalDeuda}, entidades=${entidadesMapped.length}`
  )

  // Upsert cache
  await prisma.bcraCache.upsert({
    where: { cuit },
    update: { data: result as any, consultedAt: new Date() },
    create: { cuit, data: result as any },
  })

  // Historial (best-effort)
  try {
    const session = await auth()
    if (session?.user?.id) {
      await prisma.bcraSearchHistory.create({
        data: {
          cuit,
          customerName: denominacion || '',
          semaforo,
          userId: session.user.id,
          result: result as any,
        },
      })
    }
  } catch (e) {
    logger.error('Error saving BCRA search history:', e)
  }

  return NextResponse.json({ ...result, stale: false })
}

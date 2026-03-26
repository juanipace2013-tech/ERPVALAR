import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'

const BCRA_BASE = 'https://api.bcra.gob.ar/CentralDeDeudores/v1.0'

// ── Helpers ──────────────────────────────────────────────────────────────────

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
 * Fetch al BCRA usando curl con --tlsv1.2.
 * Node.js fetch/https tienen problemas de TLS con el BCRA, pero curl funciona.
 */
function fetchBCRA(endpoint: string): any {
  const url = `${BCRA_BASE}/${endpoint}`
  console.log(`[BCRA] Fetching: ${url}`)

  try {
    const result = execSync(
      `curl -s --tlsv1.2 --max-time 30 "${url}" -H "Accept: application/json"`,
      { encoding: 'utf-8', timeout: 35000 }
    )

    if (!result || !result.trim()) {
      console.warn(`[BCRA] Empty response for ${endpoint}`)
      return { status: 404, errorMessages: ['Respuesta vacía del BCRA'] }
    }

    const parsed = JSON.parse(result.trim())
    console.log(`[BCRA] ${endpoint}: status=${parsed?.status}, hasResults=${!!parsed?.results}`)
    return parsed
  } catch (error) {
    console.error(`[BCRA] Error for ${endpoint}:`, error instanceof Error ? error.message : error)
    return { status: 500, errorMessages: ['Error al consultar BCRA'] }
  }
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

  // Cache 1h
  if (!forceRefresh) {
    const cache = await prisma.bcraCache.findUnique({ where: { cuit } })
    if (cache) {
      const age = Date.now() - new Date(cache.consultedAt).getTime()
      if (age < 1 * 60 * 60 * 1000) {
        const cached = cache.data as any
        if (cached?.resumen && cached?.deudas) {
          console.log(`[BCRA] Cache hit for ${cuit} (age: ${Math.round(age / 60000)}min)`)
          return NextResponse.json(cached)
        }
        console.warn(`[BCRA] Cache invalid for ${cuit}, refetching...`)
      }
    }
  } else {
    console.log(`[BCRA] Force refresh for ${cuit}`)
  }

  // ── Fetch 3 endpoints (curl es sincrónico, cada llamada ~1-2s) ──
  const deudas = fetchBCRA(`Deudas/${cuit}`)
  const historicas = fetchBCRA(`Deudas/Historicas/${cuit}`)
  const cheques = fetchBCRA(`Deudas/ChequesRechazados/${cuit}`)

  // ── Deudas: extraer entidades del período más reciente ──
  const periodos: any[] =
    deudas?.status === 200 ? (deudas?.results?.periodos ?? []) : []

  const periodosOrdenados = [...periodos].sort((a, b) =>
    a.periodo.localeCompare(b.periodo)
  )
  const periodoActual = periodosOrdenados[periodosOrdenados.length - 1]
  const entidadesRaw: any[] = periodoActual?.entidades ?? []

  console.log(`[BCRA] Periodo actual=${periodoActual?.periodo}, entidades=${entidadesRaw.length}`)

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

  console.log(
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
    console.error('Error saving BCRA search history:', e)
  }

  return NextResponse.json(result)
}

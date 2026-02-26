process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const BCRA_BASE = 'https://api.bcra.gob.ar/CentralDeDeudores/v1.0'

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

async function fetchBCRA(endpoint: string) {
  try {
    const url = `${BCRA_BASE}/${endpoint}`
    console.log('Fetching BCRA:', url)

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })

    console.log('BCRA response status:', response.status)

    const text = await response.text()
    console.log('BCRA response body:', text.substring(0, 200))

    if (!text) {
      return { status: 404, errorMessages: ['Respuesta vacía del BCRA'] }
    }

    return JSON.parse(text)
  } catch (error) {
    console.error('BCRA fetch error:', error)
    return { status: 500, errorMessages: [`Error al consultar BCRA: ${error}`] }
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ cuit: string }> }
) {
  const { cuit: rawCuit } = await params
  const cuit = normalizeCuit(rawCuit)

  if (cuit.length !== 11 || !/^\d+$/.test(cuit)) {
    return NextResponse.json({ error: 'CUIT inválido' }, { status: 400 })
  }

  // Check 24h cache
  const cache = await prisma.bcraCache.findUnique({ where: { cuit } })
  if (cache) {
    const age = Date.now() - new Date(cache.consultedAt).getTime()
    if (age < 24 * 60 * 60 * 1000) {
      return NextResponse.json(cache.data)
    }
  }

  // Fetch 3 endpoints in parallel
  const [deudas, historicas, cheques] = await Promise.all([
    fetchBCRA(`Deudas/${cuit}`),
    fetchBCRA(`Deudas/Historicas/${cuit}`),
    fetchBCRA(`Deudas/ChequesRechazados/${cuit}`),
  ])

  console.log('BCRA Deudas response:', JSON.stringify(deudas, null, 2))

  // ── Extraer entidades del período más reciente ───────────────────────────────
  // La API devuelve results.periodos[].entidades, no results.entidades directamente
  const periodos: any[] =
    deudas?.status === 200 ? deudas?.results?.periodos ?? [] : []

  const periodosOrdenados = [...periodos].sort((a, b) =>
    a.periodo.localeCompare(b.periodo)
  )
  const periodoActual = periodosOrdenados[periodosOrdenados.length - 1]
  const entidadesRaw: any[] = periodoActual?.entidades ?? []

  // Mapear al formato esperado por el frontend
  // El BCRA devuelve "entidad" como string (nombre), no como número
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

  // Los montos del BCRA están en miles de pesos → multiplicar × 1000
  const montoTotalDeuda = entidadesMapped.reduce(
    (sum: number, e: any) => sum + (Number(e.monto) || 0) * 1000,
    0
  )

  // ── Cheques rechazados ────────────────────────────────────────────────────────
  const causales: any[] =
    cheques?.status === 200 ? cheques?.results?.causales ?? [] : []

  let cantidadChequesRechazados = 0
  for (const causal of causales) {
    if (Array.isArray(causal.entidades)) {
      cantidadChequesRechazados += causal.entidades.length
    } else if (causal.cantidadCheques) {
      cantidadChequesRechazados += Number(causal.cantidadCheques)
    }
  }

  const semaforo =
    situacionPeor === 0 && cantidadChequesRechazados === 0
      ? 'verde'
      : calcularSemaforo(situacionPeor, cantidadChequesRechazados)

  const denominacion =
    deudas?.results?.denominacion ||
    historicas?.results?.denominacion ||
    cheques?.results?.denominacion ||
    ''

  // ── Construir respuesta con entidades aplanadas ───────────────────────────────
  // El frontend espera deudas.results.entidades (no periodos[].entidades)
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

  const result = {
    cuit: formatCuit(cuit),
    denominacion,
    deudas: deudasTransformed,
    historicas,
    cheques,
    resumen: {
      situacionPeor,
      montoTotalDeuda,
      cantidadEntidades: entidadesMapped.length,
      cantidadChequesRechazados,
      semaforo,
    },
  }

  // Upsert cache
  await prisma.bcraCache.upsert({
    where: { cuit },
    update: { data: result as any, consultedAt: new Date() },
    create: { cuit, data: result as any },
  })

  return NextResponse.json(result)
}

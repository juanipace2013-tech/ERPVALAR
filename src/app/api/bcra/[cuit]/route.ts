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

async function fetchBcra(url: string) {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    const data = await res.json()
    return data
  } catch {
    return null
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
  const [deudas, historicas, cheques] = await Promise.allSettled([
    fetchBcra(`${BCRA_BASE}/Deudas/${cuit}`),
    fetchBcra(`${BCRA_BASE}/Deudas/Historicas/${cuit}`),
    fetchBcra(`${BCRA_BASE}/Deudas/ChequesRechazados/${cuit}`),
  ])

  const deudasData = deudas.status === 'fulfilled' ? deudas.value : null
  const historicasData = historicas.status === 'fulfilled' ? historicas.value : null
  const chequesData = cheques.status === 'fulfilled' ? cheques.value : null

  // Compute resumen from deudas
  const entidades: any[] =
    deudasData?.status === 200 ? deudasData?.results?.entidades ?? [] : []

  const situacionPeor =
    entidades.length > 0
      ? Math.max(...entidades.map((e: any) => Number(e.situacion) || 1))
      : 0

  const montoTotalDeuda = entidades.reduce(
    (sum: number, e: any) => sum + (Number(e.monto) || 0),
    0
  )

  // Count cheques rechazados
  const causales: any[] =
    chequesData?.status === 200 ? chequesData?.results?.causales ?? [] : []

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
    deudasData?.results?.denominacion ||
    historicasData?.results?.denominacion ||
    chequesData?.results?.denominacion ||
    ''

  const result = {
    cuit: formatCuit(cuit),
    denominacion,
    deudas: deudasData,
    historicas: historicasData,
    cheques: chequesData,
    resumen: {
      situacionPeor,
      montoTotalDeuda,
      cantidadEntidades: entidades.length,
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

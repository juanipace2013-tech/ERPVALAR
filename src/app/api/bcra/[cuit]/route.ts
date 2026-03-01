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
  // Deshabilitar TLS solo durante el fetch al BCRA (su certificado suele fallar)
  const originalTLS = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  try {
    const url = `${BCRA_BASE}/${endpoint}`

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })

    const text = await response.text()

    if (!text) {
      return { status: 404, errorMessages: ['Respuesta vacía del BCRA'] }
    }

    return JSON.parse(text)
  } catch (error) {
    console.error('BCRA fetch error:', error)
    return { status: 500, errorMessages: [`Error al consultar BCRA: ${error}`] }
  } finally {
    // Restaurar TLS para el resto de la aplicación
    if (originalTLS !== undefined) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTLS
    } else {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    }
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

  // ── Extraer entidades del período más reciente ───────────────────────────────
  // La API devuelve results.periodos[].entidades (no results.entidades directamente)
  const periodos: any[] =
    deudas?.status === 200 ? (deudas?.results?.periodos ?? []) : []

  const periodosOrdenados = [...periodos].sort((a, b) =>
    a.periodo.localeCompare(b.periodo)
  )
  const periodoActual = periodosOrdenados[periodosOrdenados.length - 1]
  const entidadesRaw: any[] = periodoActual?.entidades ?? []

  // El BCRA devuelve "entidad" como string (nombre del banco)
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
  // Estructura real: causales[].entidades[].detalle[] (no causales[].entidades directamente)
  // causales[].causal = string (nombre de la causal)
  // causales[].entidades[].entidad = number (ID banco)
  // causales[].entidades[].detalle[].nroCheque, fechaRechazo, monto, fechaPago
  const causalesRaw: any[] =
    cheques?.status === 200 ? (cheques?.results?.causales ?? []) : []

  // Contar checks reales (sum de detalle.length de cada entidad)
  let cantidadChequesRechazados = 0
  for (const causal of causalesRaw) {
    for (const ent of causal.entidades ?? []) {
      cantidadChequesRechazados += (ent.detalle ?? []).length
    }
  }

  // Transformar a estructura plana que el frontend puede renderizar:
  // causales[].descripcionCausal + causales[].entidades[] con campos directos
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

  // Upsert cache
  await prisma.bcraCache.upsert({
    where: { cuit },
    update: { data: result as any, consultedAt: new Date() },
    create: { cuit, data: result as any },
  })

  return NextResponse.json(result)
}

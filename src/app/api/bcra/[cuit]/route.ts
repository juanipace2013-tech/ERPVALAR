import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeCuit(cuit: string): string {
  return cuit.replace(/[-.\s]/g, '').slice(0, 11)
}

function formatCuit(cuit: string): string {
  const c = normalizeCuit(cuit)
  return `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`
}

// ── GET: Obtener último resultado cacheado / historial ──────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ cuit: string }> }
) {
  const { cuit: rawCuit } = await params
  const cuit = normalizeCuit(rawCuit)

  if (cuit.length !== 11 || !/^\d+$/.test(cuit)) {
    return NextResponse.json({ error: 'CUIT inválido' }, { status: 400 })
  }

  // Buscar en cache (último resultado registrado)
  const cache = await prisma.bcraCache.findUnique({ where: { cuit } })
  if (cache) {
    return NextResponse.json(cache.data)
  }

  // Sin datos previos
  return NextResponse.json({ noData: true, cuit: formatCuit(cuit) })
}

// ── POST: Registrar resultado manual de consulta BCRA ───────────────────────
// El usuario consulta la web del BCRA manualmente y registra el resultado acá.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ cuit: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const { cuit: rawCuit } = await params
  const cuit = normalizeCuit(rawCuit)

  if (cuit.length !== 11 || !/^\d+$/.test(cuit)) {
    return NextResponse.json({ error: 'CUIT inválido' }, { status: 400 })
  }

  const body = await request.json()
  const { semaforo, notas, denominacion } = body as {
    semaforo: 'verde' | 'amarillo' | 'rojo'
    notas?: string
    denominacion?: string
  }

  if (!['verde', 'amarillo', 'rojo'].includes(semaforo)) {
    return NextResponse.json({ error: 'Semáforo inválido' }, { status: 400 })
  }

  const result = {
    cuit: formatCuit(cuit),
    denominacion: denominacion || '',
    deudas: { status: 200, results: { denominacion: denominacion || '', entidades: [] } },
    historicas: null,
    cheques: null,
    resumen: {
      situacionPeor: semaforo === 'verde' ? 1 : semaforo === 'amarillo' ? 2 : 4,
      montoTotalDeuda: 0,
      cantidadEntidades: 0,
      cantidadChequesRechazados: 0,
      semaforo,
    },
    notas: notas || '',
    registradoPor: session.user.name || session.user.email || '',
    registradoEl: new Date().toISOString(),
    _source: 'manual',
  }

  // Upsert cache
  await prisma.bcraCache.upsert({
    where: { cuit },
    update: { data: result as any, consultedAt: new Date() },
    create: { cuit, data: result as any },
  })

  // Historial
  try {
    await prisma.bcraSearchHistory.create({
      data: {
        cuit,
        customerName: denominacion || '',
        semaforo,
        userId: session.user.id,
        result: result as any,
      },
    })
  } catch (e) {
    console.error('Error saving BCRA search history:', e)
  }

  return NextResponse.json({ success: true, data: result })
}

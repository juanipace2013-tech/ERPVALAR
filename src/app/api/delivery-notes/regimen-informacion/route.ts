import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

/**
 * GET /api/delivery-notes/regimen-informacion
 *
 * Régimen de Información de Comprobantes por Lotes (ARCA, autoimpresores):
 * genera el TXT de ancho fijo con el último número de remito utilizado por
 * período (AAAAMM) para cada punto de venta autoimpresor (los que tienen
 * CaiConfig), o un listado CSV de todos los remitos para control manual.
 *
 * Query params:
 *   formato  "txt" (default) | "csv"
 *   desde    período AAAAMM inicial (default: primer mes con remitos)
 *   hasta    período AAAAMM final (default: último mes cerrado; el mes en
 *            curso nunca se incluye en el TXT porque el "último utilizado"
 *            todavía puede cambiar)
 *
 * Estructura del registro TXT (49 caracteres, tipo de registro 4 = alta):
 *   pos 1     tipo de registro ("4")
 *   pos 2-7   período AAAAMM
 *   pos 8-18  CUIT emisor (11)
 *   pos 19-32 CAI (14)
 *   pos 33-37 punto de venta (5, ceros a la izquierda)
 *   pos 38-40 tipo de comprobante ("091" = Remito R)
 *   pos 41-48 último N° utilizado en el período (8, ceros a la izquierda)
 *   pos 49    en uso ("S")
 * El campo 9 (código de régimen, pos 50-63) solo aplica a modificaciones
 * (tipo de registro 5), por eso no se emite.
 */

const TIPO_COMPROBANTE_REMITO = '091'

/** Período AAAAMM en hora argentina (UTC-3) para el corte mensual. */
function periodoArg(date: Date): string {
  const art = new Date(date.getTime() - 3 * 60 * 60 * 1000)
  return `${art.getUTCFullYear()}${String(art.getUTCMonth() + 1).padStart(2, '0')}`
}

function fechaArg(date: Date): string {
  const art = new Date(date.getTime() - 3 * 60 * 60 * 1000)
  return `${String(art.getUTCDate()).padStart(2, '0')}/${String(art.getUTCMonth() + 1).padStart(2, '0')}/${art.getUTCFullYear()}`
}

const ESTADOS: Record<string, string> = {
  PENDING: 'Pendiente',
  PREPARING: 'En preparación',
  READY: 'Listo',
  DISPATCHED: 'Despachado',
  DELIVERED: 'Entregado',
  CANCELLED: 'Anulado',
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const cuit = (process.env.ARCA_CUIT || '30715373579').replace(/\D/g, '')
    const formato = request.nextUrl.searchParams.get('formato') || 'txt'
    const desdeParam = request.nextUrl.searchParams.get('desde')
    const hastaParam = request.nextUrl.searchParams.get('hasta')

    // PVs autoimpresores = los que tienen CAI configurado
    const caiConfigs = await prisma.caiConfig.findMany({
      orderBy: { createdAt: 'asc' },
    })
    if (caiConfigs.length === 0) {
      return NextResponse.json(
        { error: 'No hay puntos de venta autoimpresores configurados (CaiConfig vacío)' },
        { status: 422 }
      )
    }
    const pvSet = new Set(caiConfigs.map((c) => c.pointOfSale))
    const caiPorPv = new Map(caiConfigs.map((c) => [c.pointOfSale, c.caiNumber]))

    const notes = await prisma.deliveryNote.findMany({
      select: {
        deliveryNumber: true,
        date: true,
        status: true,
        caiNumber: true,
        customer: { select: { name: true, businessName: true } },
      },
      orderBy: { deliveryNumber: 'asc' },
    })

    // "RE PPPP-NNNNNNNN" → solo los PVs autoimpresores
    const remitos = notes.flatMap((n) => {
      const match = n.deliveryNumber.match(/^RE (\d{4})-(\d{8})$/)
      if (!match) return []
      const pv = parseInt(match[1], 10)
      if (!pvSet.has(pv)) return []
      return [{
        pv,
        numero: parseInt(match[2], 10),
        deliveryNumber: n.deliveryNumber,
        date: n.date,
        periodo: periodoArg(n.date),
        estado: ESTADOS[n.status] ?? n.status,
        cai: n.caiNumber || caiPorPv.get(pv) || '',
        cliente: n.customer?.businessName || n.customer?.name || '',
      }]
    })

    if (remitos.length === 0) {
      return NextResponse.json(
        { error: 'No hay remitos de puntos de venta autoimpresores' },
        { status: 422 }
      )
    }

    if (formato === 'csv') {
      const header = 'Numero;Fecha;Cliente;Estado;CAI'
      const rows = remitos.map((r) =>
        [r.deliveryNumber, fechaArg(r.date), r.cliente.replace(/;/g, ','), r.estado, r.cai].join(';')
      )
      // BOM para que Excel abra el CSV como UTF-8
      const csv = '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n'
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="listado-remitos-autoimpresor.csv"',
        },
      })
    }

    // TXT: último número por (período, PV, CAI), hasta el último mes cerrado
    const hastaDefault = (() => {
      const p = periodoArg(new Date())
      const y = parseInt(p.slice(0, 4), 10)
      const m = parseInt(p.slice(4), 10)
      return m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, '0')}`
    })()
    const desde = desdeParam && /^\d{6}$/.test(desdeParam) ? desdeParam : '000000'
    const hasta = hastaParam && /^\d{6}$/.test(hastaParam) ? hastaParam : hastaDefault

    const ultimoPorPeriodo = new Map<string, { pv: number; cai: string; numero: number }>()
    for (const r of remitos) {
      if (r.periodo < desde || r.periodo > hasta) continue
      const key = `${r.periodo}|${r.pv}|${r.cai}`
      const actual = ultimoPorPeriodo.get(key)
      if (!actual || r.numero > actual.numero) {
        ultimoPorPeriodo.set(key, { pv: r.pv, cai: r.cai, numero: r.numero })
      }
    }

    const lines = [...ultimoPorPeriodo.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, u]) => {
        const periodo = key.split('|')[0]
        return (
          '4' +
          periodo +
          cuit.padStart(11, '0') +
          u.cai.padStart(14, '0') +
          String(u.pv).padStart(5, '0') +
          TIPO_COMPROBANTE_REMITO +
          String(u.numero).padStart(8, '0') +
          'S'
        )
      })

    if (lines.length === 0) {
      return NextResponse.json(
        { error: `No hay remitos en el rango ${desde}-${hasta} (el mes en curso no se incluye)` },
        { status: 422 }
      )
    }

    const primerPeriodo = lines[0].slice(1, 7)
    const ultimoPeriodo = lines[lines.length - 1].slice(1, 7)
    return new NextResponse(lines.join('\r\n') + '\r\n', {
      headers: {
        'Content-Type': 'text/plain; charset=ascii',
        'Content-Disposition': `attachment; filename="RI_remitos_${primerPeriodo}-${ultimoPeriodo}.txt"`,
      },
    })
  } catch (error) {
    logger.error('Error generando régimen de información de remitos:', error)
    return NextResponse.json(
      {
        error: 'Error al generar el reporte',
        details: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 }
    )
  }
}

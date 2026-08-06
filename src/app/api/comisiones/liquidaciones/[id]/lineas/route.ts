import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { recalcular } from '@/lib/comisiones/liquidacion'

const postSchema = z.object({
  clienteNombre: z.string().min(1).max(200),
  numeroNota: z.string().max(50).optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // fecha de la NC/venta
  montoUsd: z.number().positive(),
  // NC (default) resta; VENTA_SIN_FACTURA suma como una venta más.
  tipo: z.enum(['NC', 'VENTA_SIN_FACTURA']).default('NC'),
})

// Marcador en la columna presupuesto para las líneas manuales de venta sin
// factura ("en negro"): las distingue de las NC ('NC') y de las líneas que
// vienen de una CotizacionFactura (número de presupuesto real).
const PRESUPUESTO_VENTA_SF = 'VENTA S/F'

// POST /api/comisiones/liquidaciones/[id]/lineas — agrega una línea manual:
//  - tipo 'NC': importe USD negativo, resta de la comisión y del total
//    facturado del mes (puede bajar el tramo de la escala). Para NC parciales
//    o casos que la detección automática no matchea.
//  - tipo 'VENTA_SIN_FACTURA': importe USD positivo, suma al facturado del
//    mes y comisiona como cualquier venta (ventas sin factura).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const parsed = postSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Body inválido', detalles: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const liquidacion = await prisma.comisionLiquidacion.findUnique({ where: { id } })
    if (!liquidacion) {
      return NextResponse.json({ error: 'Liquidación no encontrada' }, { status: 404 })
    }
    if (liquidacion.estado === 'CERRADA') {
      return NextResponse.json(
        { error: 'La liquidación está cerrada: reabrila para agregar líneas' },
        { status: 400 }
      )
    }

    const { clienteNombre, numeroNota, fecha, montoUsd, tipo } = parsed.data
    const esVentaSF = tipo === 'VENTA_SIN_FACTURA'
    await prisma.comisionLinea.create({
      data: {
        vendedorId: liquidacion.vendedorId,
        liquidacionId: id,
        clienteNombre,
        presupuesto: esVentaSF ? PRESUPUESTO_VENTA_SF : 'NC',
        numeroFactura: numeroNota || null,
        // Mediodía UTC: la fecha se muestra igual en cualquier huso razonable.
        fecha: fecha ? new Date(`${fecha}T12:00:00Z`) : null,
        importeFacturadoUsd: esVentaSF ? montoUsd : -montoUsd,
        anioImputacion: liquidacion.anio,
        mesImputacion: liquidacion.mes,
        estado: 'FACTURADO',
      },
    })
    const actualizada = await recalcular(id)
    return NextResponse.json({ liquidacion: actualizada })
  } catch (e) {
    logger.error('[comisiones/lineas] POST error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { recalcular } from '@/lib/comisiones/liquidacion'

const patchSchema = z.object({
  tipoOperacion: z.enum(['BILLETE', 'DIVISA']),
})

// PATCH /api/comisiones/lineas/[id] — cambia el tipo de operación de la línea
// (define qué TC del mes se usa) y recalcula la liquidación.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const parsed = patchSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Body inválido', detalles: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const linea = await prisma.comisionLinea.findUnique({
      where: { id },
      include: { liquidacion: { select: { id: true, estado: true } } },
    })
    if (!linea) {
      return NextResponse.json({ error: 'Línea no encontrada' }, { status: 404 })
    }
    if (linea.liquidacion?.estado === 'CERRADA') {
      return NextResponse.json(
        { error: 'La liquidación está cerrada: reabrila para editar líneas' },
        { status: 400 }
      )
    }

    await prisma.comisionLinea.update({
      where: { id },
      data: { tipoOperacion: parsed.data.tipoOperacion },
    })
    const liquidacion = linea.liquidacion ? await recalcular(linea.liquidacion.id) : null
    return NextResponse.json({ liquidacion })
  } catch (e) {
    logger.error('[comisiones/lineas/[id]] PATCH error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// DELETE /api/comisiones/lineas/[id] — elimina una línea manual (NC o venta
// sin factura, sin factura de origen). Las líneas que vienen de una
// CotizacionFactura no se borran a mano: las gestiona la sincronización.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params
    const linea = await prisma.comisionLinea.findUnique({
      where: { id },
      include: { liquidacion: { select: { id: true, estado: true } } },
    })
    if (!linea) {
      return NextResponse.json({ error: 'Línea no encontrada' }, { status: 404 })
    }
    if (linea.liquidacion?.estado === 'CERRADA') {
      return NextResponse.json(
        { error: 'La liquidación está cerrada: reabrila para eliminar líneas' },
        { status: 400 }
      )
    }
    const esManual =
      linea.facturaParcialId === null &&
      (linea.presupuesto === 'NC' || linea.presupuesto === 'VENTA S/F')
    if (!esManual) {
      return NextResponse.json(
        { error: 'Solo se pueden eliminar líneas cargadas a mano (NC o venta S/F)' },
        { status: 400 }
      )
    }

    await prisma.comisionLinea.delete({ where: { id } })
    const liquidacion = linea.liquidacion ? await recalcular(linea.liquidacion.id) : null
    return NextResponse.json({ liquidacion })
  } catch (e) {
    logger.error('[comisiones/lineas/[id]] DELETE error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

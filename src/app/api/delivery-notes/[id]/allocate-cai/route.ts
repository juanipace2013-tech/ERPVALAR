import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { withDeliveryTx } from '@/lib/quote-workflow'

/**
 * POST /api/delivery-notes/[id]/allocate-cai
 *
 * Atomically allocates the next CAI number for a delivery note PDF.
 * Returns the CAI data needed to render the PDF, and updates the
 * delivery note's deliveryNumber to the new PV+number.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params

    // Check delivery note exists
    const deliveryNote = await prisma.deliveryNote.findUnique({
      where: { id },
      select: { id: true, deliveryNumber: true, caiNumber: true },
    })

    if (!deliveryNote) {
      return NextResponse.json({ error: 'Remito no encontrado' }, { status: 404 })
    }

    // If this delivery note already has a CAI number assigned, return it
    if (deliveryNote.caiNumber) {
      const caiConfig = await prisma.caiConfig.findFirst({
        where: { caiNumber: deliveryNote.caiNumber },
      })
      return NextResponse.json({
        deliveryNumber: deliveryNote.deliveryNumber,
        caiNumber: deliveryNote.caiNumber,
        caiExpirationDate: caiConfig?.caiExpirationDate || null,
        alreadyAllocated: true,
      })
    }

    // Pre-check fuera de tx para devolver errores 4xx amigables sin abrir tx
    const preCheck = await prisma.caiConfig.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
    })

    if (!preCheck) {
      return NextResponse.json(
        { error: 'No hay CAI activo. El PDF se generará sin CAI.' },
        { status: 404 }
      )
    }

    if (new Date() > preCheck.caiExpirationDate) {
      return NextResponse.json(
        { error: `El CAI ${preCheck.caiNumber} está vencido (venció el ${preCheck.caiExpirationDate.toLocaleDateString('es-AR')}). El PDF se generará sin CAI.` },
        { status: 400 }
      )
    }

    if (preCheck.lastUsedNumber + 1 > preCheck.endNumber) {
      return NextResponse.json(
        { error: `Se agotó el rango de numeración del CAI (rango ${preCheck.startNumber}-${preCheck.endNumber}). El PDF se generará sin CAI.` },
        { status: 400 }
      )
    }

    // Asignar número + actualizar remito en UNA sola tx Serializable con
    // UPDATE atómico condicional (WHERE lastUsedNumber = leído). Si otro
    // proceso incrementa primero, withDeliveryTx reintenta la tx entera.
    const allocated = await withDeliveryTx(async (tx) => {
      const caiConfig = await tx.caiConfig.findFirst({
        where: { active: true },
        orderBy: { createdAt: 'desc' },
      })
      if (!caiConfig) throw new Error('NO_ACTIVE_CAI')

      const nextNumber = caiConfig.lastUsedNumber + 1
      if (nextNumber > caiConfig.endNumber) throw new Error('CAI_RANGE_EXHAUSTED')

      // UPDATE atómico condicional: solo incrementa si nadie más lo movió
      const updated = await tx.$executeRaw`
        UPDATE cai_configs
        SET "lastUsedNumber" = "lastUsedNumber" + 1
        WHERE id = ${caiConfig.id} AND "lastUsedNumber" = ${caiConfig.lastUsedNumber}
      `
      if (updated === 0) {
        throw new Error('CAI_CONCURRENT_UPDATE')
      }

      const pv = String(caiConfig.pointOfSale).padStart(4, '0')
      const num = String(nextNumber).padStart(8, '0')
      const newDeliveryNumber = `RE ${pv}-${num}`

      await tx.deliveryNote.update({
        where: { id },
        data: {
          deliveryNumber: newDeliveryNumber,
          caiNumber: caiConfig.caiNumber,
        },
      })

      return {
        deliveryNumber: newDeliveryNumber,
        caiNumber: caiConfig.caiNumber,
        caiExpirationDate: caiConfig.caiExpirationDate,
      }
    })

    return NextResponse.json({
      ...allocated,
      alreadyAllocated: false,
    })
  } catch (error) {
    logger.error('Error allocating CAI:', error)
    return NextResponse.json(
      { error: 'Error al asignar número de CAI' },
      { status: 500 }
    )
  }
}

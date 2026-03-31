import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

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

    // Get active CAI config
    const caiConfig = await prisma.caiConfig.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
    })

    if (!caiConfig) {
      // No hay CAI activo — el PDF se generará sin CAI (legacy PV 0002)
      return NextResponse.json(
        { error: 'No hay CAI activo. El PDF se generará sin CAI.' },
        { status: 404 }
      )
    }

    // Validate expiration
    if (new Date() > caiConfig.caiExpirationDate) {
      return NextResponse.json(
        { error: `El CAI ${caiConfig.caiNumber} está vencido (venció el ${caiConfig.caiExpirationDate.toLocaleDateString('es-AR')}). El PDF se generará sin CAI.` },
        { status: 400 }
      )
    }

    // Validate range
    const nextNumber = caiConfig.lastUsedNumber + 1
    if (nextNumber > caiConfig.endNumber) {
      return NextResponse.json(
        { error: `Se agotó el rango de numeración del CAI (rango ${caiConfig.startNumber}-${caiConfig.endNumber}). El PDF se generará sin CAI.` },
        { status: 400 }
      )
    }

    // Format delivery number: RE 0006-00000001
    const pv = String(caiConfig.pointOfSale).padStart(4, '0')
    const num = String(nextNumber).padStart(8, '0')
    const newDeliveryNumber = `RE ${pv}-${num}`

    // Atomic: increment lastUsedNumber + update delivery note
    await prisma.$transaction([
      prisma.caiConfig.update({
        where: { id: caiConfig.id },
        data: { lastUsedNumber: nextNumber },
      }),
      prisma.deliveryNote.update({
        where: { id },
        data: {
          deliveryNumber: newDeliveryNumber,
          caiNumber: caiConfig.caiNumber,
        },
      }),
    ])

    return NextResponse.json({
      deliveryNumber: newDeliveryNumber,
      caiNumber: caiConfig.caiNumber,
      caiExpirationDate: caiConfig.caiExpirationDate,
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

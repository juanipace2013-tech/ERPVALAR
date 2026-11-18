import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { unlink } from 'fs/promises'
import path from 'path'
import { logger } from '@/lib/logger'
import { parseCivilDate } from '@/lib/date-helpers'
import { requireRole, ROLES } from '@/lib/authz'
import { detectarTipoOC, guardarArchivoOC } from '@/lib/quotes/oc-archivo'

const MAX_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * POST /api/quotes/[id]/upload-oc
 * Subir archivo de Orden de Compra del cliente
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params

    // Verificar que el quote existe y está aceptada
    const quote = await prisma.quote.findUnique({
      where: { id },
      select: { id: true, quoteNumber: true, status: true },
    })

    if (!quote) {
      return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })
    }

    if (quote.status !== 'ACCEPTED' && quote.status !== 'CONVERTED' && quote.status !== 'FACTURADA_PARCIAL') {
      return NextResponse.json(
        { error: 'Solo se puede adjuntar OC a cotizaciones aceptadas' },
        { status: 400 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const purchaseOrderNumber = formData.get('purchaseOrderNumber') as string | null
    const purchaseOrderDateStr = formData.get('purchaseOrderDate') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 })
    }

    // Validar tamaño
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: 'El archivo excede el límite de 10MB.' },
        { status: 400 }
      )
    }

    // Validar tipo por contenido: lo arrastrado desde el correo puede venir sin tipo declarado
    const bytes = Buffer.from(await file.arrayBuffer())
    const tipo = detectarTipoOC(bytes)
    if (!tipo) {
      return NextResponse.json(
        { error: 'Tipo de archivo no permitido. Solo JPG, PNG o PDF.' },
        { status: 400 }
      )
    }

    const purchaseOrderUrl = await guardarArchivoOC(quote.quoteNumber, bytes, tipo)

    // Actualizar quote en la base de datos
    const updateData: Record<string, unknown> = { purchaseOrderUrl }

    if (purchaseOrderNumber) {
      updateData.purchaseOrderNumber = purchaseOrderNumber
    }

    if (purchaseOrderDateStr) {
      updateData.purchaseOrderDate = parseCivilDate(purchaseOrderDateStr)
    }

    const updated = await prisma.quote.update({
      where: { id },
      data: updateData,
      select: {
        purchaseOrderUrl: true,
        purchaseOrderNumber: true,
        purchaseOrderDate: true,
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    logger.error('Error uploading purchase order:', error)
    return NextResponse.json(
      { error: 'Error al subir el archivo' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/quotes/[id]/upload-oc
 * Actualizar número y/o fecha de OC sin resubir archivo
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()

    const quote = await prisma.quote.findUnique({
      where: { id },
      select: { id: true, status: true },
    })

    if (!quote) {
      return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })
    }

    if (quote.status !== 'ACCEPTED' && quote.status !== 'CONVERTED' && quote.status !== 'FACTURADA_PARCIAL') {
      return NextResponse.json(
        { error: 'Solo se puede editar OC de cotizaciones aceptadas' },
        { status: 400 }
      )
    }

    const updateData: Record<string, unknown> = {}

    if ('purchaseOrderNumber' in body) {
      updateData.purchaseOrderNumber = body.purchaseOrderNumber || null
    }

    if ('purchaseOrderDate' in body) {
      updateData.purchaseOrderDate = body.purchaseOrderDate
        ? parseCivilDate(body.purchaseOrderDate)
        : null
    }

    const updated = await prisma.quote.update({
      where: { id },
      data: updateData,
      select: {
        purchaseOrderUrl: true,
        purchaseOrderNumber: true,
        purchaseOrderDate: true,
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    logger.error('Error updating purchase order:', error)
    return NextResponse.json(
      { error: 'Error al actualizar la orden de compra' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/quotes/[id]/upload-oc
 * Eliminar archivo de Orden de Compra
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const forbidden = requireRole(session, ROLES.OPERATIVOS)
    if (forbidden) return forbidden

    const { id } = await params

    const quote = await prisma.quote.findUnique({
      where: { id },
      select: { id: true, purchaseOrderUrl: true },
    })

    if (!quote) {
      return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })
    }

    // Intentar eliminar el archivo físico
    if (quote.purchaseOrderUrl) {
      try {
        const filePath = path.join(process.cwd(), 'public', quote.purchaseOrderUrl)
        await unlink(filePath)
      } catch {
        // Si el archivo no existe, continuar igualmente
      }
    }

    // Limpiar campos en la base de datos
    await prisma.quote.update({
      where: { id },
      data: {
        purchaseOrderUrl: null,
        purchaseOrderNumber: null,
        purchaseOrderDate: null,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting purchase order:', error)
    return NextResponse.json(
      { error: 'Error al eliminar la orden de compra' },
      { status: 500 }
    )
  }
}

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir, unlink } from 'fs/promises'
import path from 'path'

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'cotizaciones-oc')
const MAX_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

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

    if (quote.status !== 'ACCEPTED' && quote.status !== 'CONVERTED') {
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

    // Validar tipo
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Tipo de archivo no permitido. Solo JPG, PNG o PDF.' },
        { status: 400 }
      )
    }

    // Validar tamaño
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: 'El archivo excede el límite de 10MB.' },
        { status: 400 }
      )
    }

    // Crear directorio si no existe
    await mkdir(UPLOAD_DIR, { recursive: true })

    // Generar nombre de archivo único
    const ext = file.name.split('.').pop() || 'pdf'
    const safeNumber = quote.quoteNumber.replace(/\s/g, '-')
    const timestamp = Date.now()
    const fileName = `${safeNumber}_oc_${timestamp}.${ext}`
    const filePath = path.join(UPLOAD_DIR, fileName)

    // Escribir archivo
    const bytes = await file.arrayBuffer()
    await writeFile(filePath, Buffer.from(bytes))

    // Actualizar quote en la base de datos
    const updateData: Record<string, unknown> = {
      purchaseOrderUrl: `/uploads/cotizaciones-oc/${fileName}`,
    }

    if (purchaseOrderNumber) {
      updateData.purchaseOrderNumber = purchaseOrderNumber
    }

    if (purchaseOrderDateStr) {
      updateData.purchaseOrderDate = new Date(purchaseOrderDateStr)
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
    console.error('Error uploading purchase order:', error)
    return NextResponse.json(
      { error: 'Error al subir el archivo' },
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
    console.error('Error deleting purchase order:', error)
    return NextResponse.json(
      { error: 'Error al eliminar la orden de compra' },
      { status: 500 }
    )
  }
}

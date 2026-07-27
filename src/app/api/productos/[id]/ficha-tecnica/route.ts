import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir, unlink } from 'fs/promises'
import path from 'path'
import { logger } from '@/lib/logger'

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'fichas-tecnicas')
const MAX_SIZE = 3 * 1024 * 1024 // 3MB (límite por archivo del email)
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png']

/**
 * POST /api/productos/[id]/ficha-tecnica
 * Subir la ficha técnica del producto (reemplaza la anterior si existe)
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

    const product = await prisma.product.findUnique({
      where: { id },
      select: { id: true, sku: true, technicalSheetUrl: true },
    })

    if (!product) {
      return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Tipo de archivo no permitido. Solo PDF, JPG o PNG.' },
        { status: 400 }
      )
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: 'El archivo excede el límite de 3MB (límite de adjuntos del email).' },
        { status: 400 }
      )
    }

    await mkdir(UPLOAD_DIR, { recursive: true })

    const ext = file.name.split('.').pop() || 'pdf'
    const safeSku = product.sku.replace(/[^a-zA-Z0-9-_]/g, '-')
    const fileName = `${safeSku}_ficha_${Date.now()}.${ext}`
    const filePath = path.join(UPLOAD_DIR, fileName)

    const bytes = await file.arrayBuffer()
    await writeFile(filePath, Buffer.from(bytes))

    // Borrar la ficha anterior si había
    if (product.technicalSheetUrl) {
      try {
        await unlink(path.join(process.cwd(), 'public', product.technicalSheetUrl))
      } catch {
        // Si el archivo no existe, continuar igualmente
      }
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        technicalSheetUrl: `/uploads/fichas-tecnicas/${fileName}`,
        technicalSheetName: file.name,
      },
      select: { technicalSheetUrl: true, technicalSheetName: true },
    })

    return NextResponse.json(updated)
  } catch (error) {
    logger.error('Error uploading technical sheet:', error)
    return NextResponse.json(
      { error: 'Error al subir la ficha técnica' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/productos/[id]/ficha-tecnica
 * Eliminar la ficha técnica del producto
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

    const product = await prisma.product.findUnique({
      where: { id },
      select: { id: true, technicalSheetUrl: true },
    })

    if (!product) {
      return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 })
    }

    if (product.technicalSheetUrl) {
      try {
        await unlink(path.join(process.cwd(), 'public', product.technicalSheetUrl))
      } catch {
        // Si el archivo no existe, continuar igualmente
      }
    }

    await prisma.product.update({
      where: { id },
      data: { technicalSheetUrl: null, technicalSheetName: null },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting technical sheet:', error)
    return NextResponse.json(
      { error: 'Error al eliminar la ficha técnica' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/quotes/[id]/fichas-tecnicas
 * Lista las fichas técnicas disponibles de los productos de una cotización.
 * Usado por el diálogo de envío de email para adjuntarlas automáticamente.
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { stat } from 'fs/promises'
import path from 'path'
import { logger } from '@/lib/logger'

export async function GET(
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
      select: {
        items: {
          select: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                technicalSheetUrl: true,
                technicalSheetName: true,
              },
            },
          },
        },
      },
    })

    if (!quote) {
      return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })
    }

    // Dedup por producto (el mismo producto puede estar en varios ítems)
    const seen = new Set<string>()
    const fichas: Array<{
      productId: string
      sku: string
      productName: string
      filename: string
      size: number | null
    }> = []

    for (const item of quote.items) {
      const p = item.product
      if (!p?.technicalSheetUrl || seen.has(p.id)) continue
      seen.add(p.id)

      // Tamaño del archivo (null si no existe en disco)
      let size: number | null = null
      try {
        const info = await stat(path.join(process.cwd(), 'public', p.technicalSheetUrl))
        size = info.size
      } catch {
        // Archivo faltante en disco: no ofrecer la ficha
        continue
      }

      fichas.push({
        productId: p.id,
        sku: p.sku,
        productName: p.name,
        filename: p.technicalSheetName || path.basename(p.technicalSheetUrl),
        size,
      })
    }

    return NextResponse.json({ fichas })
  } catch (error) {
    logger.error('Error listing technical sheets for quote:', error)
    return NextResponse.json(
      { error: 'Error al buscar fichas técnicas' },
      { status: 500 }
    )
  }
}

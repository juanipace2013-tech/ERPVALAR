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
    // y después por archivo: productos de la misma familia comparten la
    // misma ficha (mismo nombre y tamaño), se ofrece una sola vez.
    const seenProducts = new Set<string>()
    const byFile = new Map<
      string,
      {
        productId: string
        skus: string[]
        productName: string
        filename: string
        size: number | null
      }
    >()

    for (const item of quote.items) {
      const p = item.product
      if (!p?.technicalSheetUrl || seenProducts.has(p.id)) continue
      seenProducts.add(p.id)

      // Tamaño del archivo (si no existe en disco, no ofrecer la ficha)
      let size: number
      try {
        const info = await stat(path.join(process.cwd(), 'public', p.technicalSheetUrl))
        size = info.size
      } catch {
        continue
      }

      const filename = p.technicalSheetName || path.basename(p.technicalSheetUrl)
      const key = `${filename}|${size}`
      const existing = byFile.get(key)
      if (existing) {
        existing.skus.push(p.sku)
      } else {
        byFile.set(key, {
          productId: p.id,
          skus: [p.sku],
          productName: p.name,
          filename,
          size,
        })
      }
    }

    const fichas = Array.from(byFile.values()).map((f) => ({
      productId: f.productId,
      sku: f.skus.join(', '),
      productName: f.productName,
      filename: f.filename,
      size: f.size,
    }))

    return NextResponse.json({ fichas })
  } catch (error) {
    logger.error('Error listing technical sheets for quote:', error)
    return NextResponse.json(
      { error: 'Error al buscar fichas técnicas' },
      { status: 500 }
    )
  }
}

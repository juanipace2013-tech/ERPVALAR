/**
 * API Endpoint: /api/colppy/inventario
 *
 * Thin wrapper sobre src/lib/colppy-inventory.ts. La lógica de cache, carga
 * masiva y sync hacia la tabla products vive en el lib para poder reusarse
 * desde el flujo post-facturación.
 *
 * COMPORTAMIENTO OBSERVABLE: idéntico a la versión anterior — mismo flujo,
 * misma respuesta JSON, mismos strings de log. No hay cambios para el botón
 * "Actualizar Stock" del módulo Inventario / Facturación / Cotizaciones.
 */

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { auth } from '@/auth'
import {
  loadAllInventory,
  refreshCacheAndSyncAllProducts,
} from '@/lib/colppy-inventory'

/**
 * GET /api/colppy/inventario?sku=2025 04
 * GET /api/colppy/inventario?skus=2025 04,3028 05,PEM1297R6R11
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const sku = searchParams.get('sku')
    const skusParam = searchParams.get('skus')

    // Cargar cache si es necesario
    const inventory = await loadAllInventory()

    // Búsqueda por SKU único
    if (sku) {
      const item = inventory.get(sku)

      if (item) {
        return NextResponse.json({
          found: true,
          stock: item.disponibilidad,
          colppyItemId: item.colppyItemId,
          codigo: item.codigo,
          descripcion: item.descripcion,
        })
      } else {
        return NextResponse.json({
          found: false,
          stock: 0,
          colppyItemId: null,
        })
      }
    }

    // Búsqueda por múltiples SKUs
    if (skusParam) {
      const skus = skusParam.split(',').map((s) => s.trim())
      const items: Record<string, any> = {}

      for (const s of skus) {
        const item = inventory.get(s)
        if (item) {
          items[s] = {
            found: true,
            stock: item.disponibilidad,
            colppyItemId: item.colppyItemId,
            descripcion: item.descripcion,
          }
        } else {
          items[s] = {
            found: false,
            stock: 0,
            colppyItemId: null,
          }
        }
      }

      return NextResponse.json({
        items,
        totalInCache: inventory.size,
        cached: true,
      })
    }

    // Sin parámetros
    return NextResponse.json(
      {
        error: 'Debe proporcionar sku o skus',
        totalInCache: inventory.size,
      },
      { status: 400 }
    )
  } catch (error: any) {
    logger.error('Error obteniendo inventario:', error)
    return NextResponse.json(
      {
        error: error.message || 'Error al obtener inventario',
        found: false,
        stock: 0,
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/colppy/inventario
 * Refresca el cache de inventario desde Colppy Y persiste stockQuantity
 * en la tabla products (match por SKU o colppyItemId).
 *
 * Esto es crítico para el tablero de facturación que lee stockQuantity de la DB.
 */
export async function POST() {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    logger.info(
      '[Colppy Inventario] Refrescando cache y persistiendo stock en DB...'
    )

    const result = await refreshCacheAndSyncAllProducts()

    return NextResponse.json({
      success: true,
      message: `Cache refrescado: ${result.total} items cargados`,
      total: result.total,
      stockSync: {
        updated: result.stockSync.updated,
        unchanged: result.stockSync.unchanged,
        notFound: result.stockSync.notFound,
        totalProducts: result.stockSync.totalProducts,
      },
    })
  } catch (error: any) {
    logger.error('Error refrescando cache:', error)
    return NextResponse.json(
      { error: error.message || 'Error al refrescar cache' },
      { status: 500 }
    )
  }
}

/**
 * API Endpoint: GET /api/colppy/inventario
 * Obtiene stock de productos desde el inventario de Colppy
 *
 * ESTRATEGIA: Cargar TODOS los items (2,805) en bloques de 500, cachear
 * por 5 minutos. Búsqueda local instantánea por código (SKU).
 */

import { NextRequest, NextResponse } from 'next/server';
import * as crypto from 'crypto';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

// ============================================================================
// CONFIGURACIÓN
// ============================================================================

const COLPPY_ENDPOINT = 'https://login.colppy.com/lib/frontera2/service.php';
const COLPPY_USER = process.env.COLPPY_USER || '';
const COLPPY_PASSWORD = process.env.COLPPY_PASSWORD || '';
const COLPPY_ID_EMPRESA = process.env.COLPPY_ID_EMPRESA || '';

function md5(text: string): string {
  return crypto.createHash('md5').update(text).digest('hex');
}

// ============================================================================
// CACHE EN MEMORIA
// ============================================================================

interface InventoryItem {
  colppyItemId: number;
  codigo: string;
  descripcion: string;
  disponibilidad: number; // Stock disponible
  precioVenta: number;
  costoCalculado: number;
}

let inventoryCache: Map<string, InventoryItem> = new Map();
let cacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos (el stock cambia más seguido que los clientes)

let cachedSession: { claveSesion: string; timestamp: number } | null = null;
const SESSION_TTL = 20 * 60 * 1000; // 20 minutos

// ============================================================================
// FUNCIONES COLPPY
// ============================================================================

async function callColppy(payload: any): Promise<any> {
  const response = await fetch(COLPPY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Colppy HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function getSession(): Promise<string> {
  if (cachedSession && Date.now() - cachedSession.timestamp < SESSION_TTL) {
    return cachedSession.claveSesion;
  }

  const passwordMD5 = md5(COLPPY_PASSWORD);
  const response = await callColppy({
    auth: { usuario: COLPPY_USER, password: passwordMD5 },
    service: { provision: 'Usuario', operacion: 'iniciar_sesion' },
    parameters: { usuario: COLPPY_USER, password: passwordMD5 },
  });

  if (response.result?.estado !== 0) {
    throw new Error(`Error login Colppy: ${response.result?.mensaje}`);
  }

  cachedSession = {
    claveSesion: response.response.data.claveSesion,
    timestamp: Date.now(),
  };

  return cachedSession.claveSesion;
}

// ============================================================================
// CARGAR INVENTARIO COMPLETO (en bloques de 500)
// ============================================================================

async function loadAllInventory(): Promise<Map<string, InventoryItem>> {
  // Si cache es reciente, devolver
  if (inventoryCache.size > 0 && (Date.now() - cacheTimestamp) < CACHE_TTL) {
    return inventoryCache;
  }

  logger.info('[Colppy Inventario] Cargando todos los items...');
  const startTime = Date.now();

  const claveSesion = await getSession();
  const passwordMD5 = md5(COLPPY_PASSWORD);

  let allItems: any[] = [];
  let start = 0;
  const BLOCK_SIZE = 500;

  // Traer en bloques de 500
  while (true) {
    const response = await callColppy({
      auth: { usuario: COLPPY_USER, password: passwordMD5 },
      service: { provision: 'Inventario', operacion: 'listar_itemsinventario' },
      parameters: {
        sesion: { usuario: COLPPY_USER, claveSesion },
        idEmpresa: COLPPY_ID_EMPRESA,
        start,
        limit: BLOCK_SIZE,
        filter: [],
        order: { field: 'codigo', order: 'asc' },
      },
    });

    if (response.result?.estado !== 0 || !response.response?.success) {
      // Si sesión expiró, reintentar
      if (start === 0) {
        cachedSession = null;
        const newSession = await getSession();

        const retry = await callColppy({
          auth: { usuario: COLPPY_USER, password: md5(COLPPY_PASSWORD) },
          service: { provision: 'Inventario', operacion: 'listar_itemsinventario' },
          parameters: {
            sesion: { usuario: COLPPY_USER, claveSesion: newSession },
            idEmpresa: COLPPY_ID_EMPRESA,
            start,
            limit: BLOCK_SIZE,
            filter: [],
            order: { field: 'codigo', order: 'asc' },
          },
        });

        if (retry.result?.estado !== 0 || !retry.response?.success) {
          throw new Error(
            retry.result?.mensaje || retry.response?.message || 'Error cargando inventario'
          );
        }

        const items = retry.response.data || [];
        allItems = allItems.concat(items);
        const total = parseInt(retry.response.total || '0');
        start += BLOCK_SIZE;

        if (start >= total || items.length === 0) break;
      } else {
        throw new Error(
          response.result?.mensaje || response.response?.message || 'Error cargando inventario'
        );
      }
    } else {
      const items = response.response.data || [];
      allItems = allItems.concat(items);

      const total = parseInt(response.response.total || '0');
      start += BLOCK_SIZE;

      if (start >= total || items.length === 0) break;
    }
  }

  // Crear mapa código → item
  const newCache = new Map<string, InventoryItem>();
  for (const item of allItems) {
    newCache.set(item.codigo, {
      colppyItemId: parseInt(item.idItem),
      codigo: item.codigo,
      descripcion: item.descripcion || '',
      disponibilidad: parseFloat(item.disponibilidad || '0'),
      precioVenta: parseFloat(item.precioVenta || '0'),
      costoCalculado: parseFloat(item.costoCalculado || '0'),
    });
  }

  inventoryCache = newCache;
  cacheTimestamp = Date.now();
  const elapsed = Date.now() - startTime;
  logger.info(`[Colppy Inventario] ${newCache.size} items cargados en ${elapsed}ms`);

  return inventoryCache;
}

// ============================================================================
// ENDPOINTS
// ============================================================================

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

    const { searchParams } = new URL(request.url);
    const sku = searchParams.get('sku');
    const skusParam = searchParams.get('skus');

    // Cargar cache si es necesario
    const inventory = await loadAllInventory();

    // Búsqueda por SKU único
    if (sku) {
      const item = inventory.get(sku);

      if (item) {
        return NextResponse.json({
          found: true,
          stock: item.disponibilidad,
          colppyItemId: item.colppyItemId,
          codigo: item.codigo,
          descripcion: item.descripcion,
        });
      } else {
        return NextResponse.json({
          found: false,
          stock: 0,
          colppyItemId: null,
        });
      }
    }

    // Búsqueda por múltiples SKUs
    if (skusParam) {
      const skus = skusParam.split(',').map(s => s.trim());
      const items: Record<string, any> = {};

      for (const s of skus) {
        const item = inventory.get(s);
        if (item) {
          items[s] = {
            found: true,
            stock: item.disponibilidad,
            colppyItemId: item.colppyItemId,
            descripcion: item.descripcion,
          };
        } else {
          items[s] = {
            found: false,
            stock: 0,
            colppyItemId: null,
          };
        }
      }

      return NextResponse.json({
        items,
        totalInCache: inventory.size,
        cached: true,
      });
    }

    // Sin parámetros
    return NextResponse.json({
      error: 'Debe proporcionar sku o skus',
      totalInCache: inventory.size,
    }, { status: 400 });

  } catch (error: any) {
    logger.error('Error obteniendo inventario:', error);
    return NextResponse.json(
      {
        error: error.message || 'Error al obtener inventario',
        found: false,
        stock: 0,
      },
      { status: 500 }
    );
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

    logger.info('[Colppy Inventario] Refrescando cache y persistiendo stock en DB...');

    // Invalidar cache
    cacheTimestamp = 0;
    inventoryCache = new Map();

    // Recargar desde Colppy
    const inventory = await loadAllInventory();

    // ====================================================================
    // PERSISTIR stockQuantity EN LA TABLA products
    // ====================================================================

    // Obtener todos los productos de la DB con su SKU y colppyItemId
    const products = await prisma.product.findMany({
      select: {
        id: true,
        sku: true,
        colppyItemId: true,
        stockQuantity: true,
      },
    });

    // Crear mapa inverso colppyItemId → InventoryItem para match alternativo
    const colppyIdMap = new Map<number, InventoryItem>();
    for (const item of inventory.values()) {
      colppyIdMap.set(item.colppyItemId, item);
    }

    let updated = 0;
    let unchanged = 0;
    let notFound = 0;

    // Actualizar en batch usando transacciones
    const updates: Array<{ id: string; stockQuantity: number }> = [];

    for (const product of products) {
      // Intentar match por SKU primero, luego por colppyItemId
      let colppyItem = inventory.get(product.sku);

      if (!colppyItem && product.colppyItemId) {
        colppyItem = colppyIdMap.get(product.colppyItemId);
      }

      if (!colppyItem) {
        notFound++;
        continue;
      }

      const newStock = Math.floor(colppyItem.disponibilidad); // Int en schema

      if (product.stockQuantity !== newStock) {
        updates.push({ id: product.id, stockQuantity: newStock });
        updated++;
      } else {
        unchanged++;
      }
    }

    // Ejecutar updates en batch (transacción)
    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map((u) =>
          prisma.product.update({
            where: { id: u.id },
            data: { stockQuantity: u.stockQuantity },
          })
        )
      );
    }

    logger.info(
      `[Colppy Inventario] Stock persistido: ${updated} actualizados, ${unchanged} sin cambios, ${notFound} sin match`
    );

    return NextResponse.json({
      success: true,
      message: `Cache refrescado: ${inventory.size} items cargados`,
      total: inventory.size,
      stockSync: {
        updated,
        unchanged,
        notFound,
        totalProducts: products.length,
      },
    });
  } catch (error: any) {
    logger.error('Error refrescando cache:', error);
    return NextResponse.json(
      { error: error.message || 'Error al refrescar cache' },
      { status: 500 }
    );
  }
}

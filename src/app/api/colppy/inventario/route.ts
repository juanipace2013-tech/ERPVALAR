/**
 * API Endpoint: GET /api/colppy/inventario
 * Obtiene stock de productos desde el inventario de Colppy
 *
 * ESTRATEGIA: Cargar TODOS los items (2,805) en bloques de 500, cachear
 * por 5 minutos. Búsqueda local instantánea por código (SKU).
 */

import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

function callColppy(payload: any): any {
  let tempFile: string | null = null;

  try {
    // Crear archivo temporal para el payload
    tempFile = path.join(os.tmpdir(), `colppy-${Date.now()}.json`);
    const payloadStr = JSON.stringify(payload);
    fs.writeFileSync(tempFile, payloadStr, 'utf-8');

    // Ejecutar curl usando el archivo temporal
    const cmd = `curl -s -X POST "${COLPPY_ENDPOINT}" -H "Content-Type: application/json" -d @"${tempFile}" --max-time 120 -L`;

    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 125000,
      maxBuffer: 50 * 1024 * 1024, // 50MB
    });

    return JSON.parse(result);
  } catch (error: any) {
    throw new Error(`Error llamando a Colppy: ${error.message}`);
  } finally {
    // Limpiar archivo temporal
    if (tempFile && fs.existsSync(tempFile)) {
      try {
        fs.unlinkSync(tempFile);
      } catch {
        // Ignorar error al limpiar
      }
    }
  }
}

function getSession(): string {
  // Reutilizar sesión si es válida
  if (cachedSession && Date.now() - cachedSession.timestamp < SESSION_TTL) {
    return cachedSession.claveSesion;
  }

  // Crear nueva sesión
  const passwordMD5 = md5(COLPPY_PASSWORD);
  const response = callColppy({
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

function loadAllInventory(): Map<string, InventoryItem> {
  // Si cache es reciente, devolver
  if (inventoryCache.size > 0 && (Date.now() - cacheTimestamp) < CACHE_TTL) {
    return inventoryCache;
  }

  console.log('[Colppy Inventario] Cargando todos los items...');
  const startTime = Date.now();

  const claveSesion = getSession();
  const passwordMD5 = md5(COLPPY_PASSWORD);

  let allItems: any[] = [];
  let start = 0;
  const BLOCK_SIZE = 500;

  // Traer en bloques de 500
  while (true) {
    const response = callColppy({
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
        const newSession = getSession();

        const retry = callColppy({
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
  console.log(`[Colppy Inventario] ${newCache.size} items cargados en ${elapsed}ms`);

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
    const { searchParams } = new URL(request.url);
    const sku = searchParams.get('sku');
    const skusParam = searchParams.get('skus');

    // Cargar cache si es necesario
    const inventory = loadAllInventory();

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
    console.error('Error obteniendo inventario:', error);
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
 * Refresca el cache de inventario manualmente
 */
export async function POST() {
  try {
    console.log('[Colppy Inventario] Refrescando cache manualmente...');

    // Invalidar cache
    cacheTimestamp = 0;
    inventoryCache = new Map();

    // Recargar
    const inventory = loadAllInventory();

    return NextResponse.json({
      success: true,
      message: `Cache refrescado: ${inventory.size} items cargados`,
      total: inventory.size,
    });
  } catch (error: any) {
    console.error('Error refrescando cache:', error);
    return NextResponse.json(
      { error: error.message || 'Error al refrescar cache' },
      { status: 500 }
    );
  }
}

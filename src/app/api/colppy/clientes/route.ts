/**
 * API Endpoint: GET /api/colppy/clientes
 * Busca clientes en Colppy con cache en memoria
 *
 * ESTRATEGIA: Cargar TODOS los clientes de una vez (~2 seg) y cachear en memoria
 * por 10 minutos. Búsqueda local instantánea.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as crypto from 'crypto';
import { logger } from '@/lib/logger';
import { getMultiplierForClient } from '@/lib/client-multipliers';
import { mapColppyTaxCondition } from '@/lib/colppy-tax-map';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

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

interface CachedCustomer {
  id: string;
  colppyId: string;
  name: string;
  businessName: string;
  cuit: string;
  taxCondition: string;
  taxConditionDisplay: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  phone: string;
  mobile: string;
  email: string;
  saldo: number;
  priceMultiplier: number;
  paymentTerms: string; // Condición de pago en texto (ej: "a 30 Días")
  paymentTermsDays: number; // Días de la condición de pago (ej: 30)
  searchText: string; // nombre + cuit + razón social en minúsculas para búsqueda rápida
}

let customerCache: CachedCustomer[] = [];
let cacheTimestamp: number = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos

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
    signal: AbortSignal.timeout(30000), // 30 segundos max
  });

  if (!response.ok) {
    throw new Error(`Colppy HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function getSession(): Promise<string> {
  // Reutilizar sesión si es válida
  if (cachedSession && Date.now() - cachedSession.timestamp < SESSION_TTL) {
    return cachedSession.claveSesion;
  }

  // Crear nueva sesión
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
// CARGAR TODOS LOS CLIENTES
// ============================================================================

async function loadAllCustomers(): Promise<CachedCustomer[]> {
  // Si el cache es reciente, usar lo que hay
  if (customerCache.length > 0 && Date.now() - cacheTimestamp < CACHE_TTL) {
    return customerCache;
  }

  logger.info('[Colppy] Cargando todos los clientes...');
  const startTime = Date.now();

  const claveSesion = await getSession();
  const passwordMD5 = md5(COLPPY_PASSWORD);

  const response = await callColppy({
    auth: { usuario: COLPPY_USER, password: passwordMD5 },
    service: { provision: 'Cliente', operacion: 'listar_cliente' },
    parameters: {
      sesion: { usuario: COLPPY_USER, claveSesion },
      idEmpresa: COLPPY_ID_EMPRESA,
      start: 0,
      limit: 6000,
      filter: [],
      order: [{ field: 'NombreFantasia', dir: 'asc' }],
    },
  });

  if (response.result?.estado !== 0 || !response.response?.success) {
    // Si sesión expiró, reintentar
    cachedSession = null;
    const newSession = await getSession();

    const retry = await callColppy({
      auth: { usuario: COLPPY_USER, password: md5(COLPPY_PASSWORD) },
      service: { provision: 'Cliente', operacion: 'listar_cliente' },
      parameters: {
        sesion: { usuario: COLPPY_USER, claveSesion: newSession },
        idEmpresa: COLPPY_ID_EMPRESA,
        start: 0,
        limit: 6000,
        filter: [],
        order: [{ field: 'NombreFantasia', dir: 'asc' }],
      },
    });

    if (retry.result?.estado !== 0 || !retry.response?.success) {
      throw new Error(
        retry.result?.mensaje || retry.response?.message || 'Error cargando clientes'
      );
    }

    const localMultipliers = await loadLocalMultipliers();
    customerCache = mapCustomers(retry.response.data, localMultipliers);
  } else {
    const localMultipliers = await loadLocalMultipliers();
    customerCache = mapCustomers(response.response.data, localMultipliers);
  }

  cacheTimestamp = Date.now();
  const elapsed = Date.now() - startTime;
  logger.info(`[Colppy] ${customerCache.length} clientes cargados en ${elapsed}ms`);

  return customerCache;
}

/**
 * Carga el map de priceMultiplier de todos los clientes locales, indexado por
 * CUIT normalizado (solo dígitos). El valor de la BD prima sobre la tabla
 * hardcoded de CLIENT_MULTIPLIERS si el usuario lo editó desde la ficha.
 */
async function loadLocalMultipliers(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const rows = await prisma.customer.findMany({
      select: { cuit: true, priceMultiplier: true },
    });
    for (const row of rows) {
      const normalized = (row.cuit || '').replace(/\D/g, '');
      if (normalized) {
        map.set(normalized, Number(row.priceMultiplier));
      }
    }
  } catch (err) {
    logger.error('[Colppy] Error cargando multipliers locales, se usará fallback:', err);
  }
  return map;
}

function mapCustomers(data: any[], localMultipliers: Map<string, number>): CachedCustomer[] {
  // Mapeo de condición IVA: ver src/lib/colppy-tax-map.ts
  const paymentTermsMap: Record<string, string> = {
    '0': 'Contado',
    '7': 'a 7 Días',
    '15': 'a 15 Días',
    '30': 'a 30 Días',
    '45': 'a 45 Días',
    '60': 'a 60 Días',
    '90': 'a 90 Días',
    '120': 'a 120 Días',
  };

  // === DIAGNÓSTICO: Log del primer cliente para descubrir campos reales ===
  if (data && data.length > 0) {
    logger.info('=== COLPPY CUSTOMER RAW FIELDS (primer cliente) ===');
    logger.info(JSON.stringify(data[0], null, 2));
    logger.info('=== FIN RAW FIELDS ===');
  }

  return (data || []).map((c: any) => {
    const name = c.NombreFantasia || c.RazonSocial || '';
    const businessName = c.RazonSocial || '';
    const cuit = c.CUIT || '';

    // Intentar múltiples nombres posibles para la condición de pago
    const idCondicionPago = String(
      c.idCondicionPago
      || c.IdCondicionPago
      || c.condicionPago
      || c.CondicionPago
      || c.condPago
      || c.PaymentTerms
      || c.paymentTerms
      || c.idCondPago
      || '0'
    );

    const { taxCondition, display: taxConditionDisplay } = mapColppyTaxCondition(
      c.idCondicionIva,
      `CUIT ${cuit}, cliente ${name}`
    );

    // Multiplier: priorizar valor editado en BD local (por CUIT),
    // cae al hardcoded por razón social si el cliente no existe localmente.
    const normalizedCuit = cuit.replace(/\D/g, '');
    const localMultiplier = normalizedCuit ? localMultipliers.get(normalizedCuit) : undefined;
    const priceMultiplier = localMultiplier ?? getMultiplierForClient(businessName);

    return {
      id: c.idCliente,
      colppyId: c.idCliente,
      name,
      businessName,
      cuit,
      taxCondition,
      taxConditionDisplay,
      address: c.DirPostal || '',
      city: c.DirPostalCiudad || '',
      province: c.DirPostalProvincia || '',
      postalCode: c.DirPostalCodigoPostal || '',
      phone: c.Telefono || '',
      mobile: c.Celular || '',
      email: c.Email || '',
      saldo: parseFloat(c.Saldo || '0'),
      priceMultiplier,
      paymentTerms: paymentTermsMap[idCondicionPago] || 'Contado',
      paymentTermsDays: parseInt(idCondicionPago) || 0,
      searchText: `${name} ${cuit} ${cuit.replace(/\D/g, '')} ${businessName}`.toLowerCase(),
    };
  });
}

// ============================================================================
// ENDPOINTS
// ============================================================================

/**
 * GET /api/colppy/clientes
 * Busca clientes en el cache local
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url);
    const search = (searchParams.get('search') || '').trim().toLowerCase();
    const limit = parseInt(searchParams.get('limit') || '20');
    const all = searchParams.get('all') === 'true';
    const id = searchParams.get('id') || '';

    // Cargar cache si es necesario (puede tardar ~2 seg la primera vez)
    const allCustomers = await loadAllCustomers();

    // Modo: buscar por Colppy ID
    if (id) {
      const customer = allCustomers.find((c) => c.colppyId === id || c.id === id);
      return NextResponse.json({
        customers: customer ? [customer] : [],
        total: customer ? 1 : 0,
        cached: true,
      });
    }

    // Modo: retornar TODOS los clientes (para listado completo)
    if (all) {
      return NextResponse.json({
        customers: allCustomers,
        total: allCustomers.length,
        cached: true,
      });
    }

    // Modo estándar: búsqueda con mínimo 2 caracteres
    if (search.length < 2) {
      return NextResponse.json({
        customers: [],
        total: allCustomers.length,
        cached: true,
        message: 'Escribí al menos 2 caracteres para buscar',
      });
    }

    // Buscar localmente (instantáneo)
    // Soporta búsqueda por múltiples términos (ej: "dist buenos aires")
    const searchTerms = search.split(/\s+/);
    const results = allCustomers
      .filter((c) => searchTerms.every((term) => c.searchText.includes(term)))
      .slice(0, limit);

    return NextResponse.json({
      customers: results,
      total: results.length,
      totalInCache: allCustomers.length,
      cached: true,
    });
  } catch (error: any) {
    logger.error('Error buscando clientes:', error);
    return NextResponse.json(
      {
        error: error.message || 'Error al buscar clientes',
        customers: [],
        total: 0,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/colppy/clientes/refresh
 * Refresca el cache de clientes manualmente
 */
export async function POST() {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    logger.info('[Colppy] Refrescando cache de clientes manualmente...');

    // Invalidar cache
    cacheTimestamp = 0;
    customerCache = [];

    // Recargar
    const customers = await loadAllCustomers();

    return NextResponse.json({
      success: true,
      message: `Cache refrescado: ${customers.length} clientes cargados`,
      total: customers.length,
    });
  } catch (error: any) {
    logger.error('Error refrescando cache:', error);
    return NextResponse.json(
      { error: error.message || 'Error al refrescar cache' },
      { status: 500 }
    );
  }
}

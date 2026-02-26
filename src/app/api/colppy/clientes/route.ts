/**
 * API Endpoint: GET /api/colppy/clientes
 * Busca clientes en Colppy con cache en memoria
 *
 * ESTRATEGIA: Cargar TODOS los clientes de una vez (~2 seg) y cachear en memoria
 * por 10 minutos. Búsqueda local instantánea.
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

function callColppy(payload: any): any {
  let tempFile: string | null = null;

  try {
    // Crear archivo temporal para el payload
    tempFile = path.join(os.tmpdir(), `colppy-${Date.now()}.json`);
    const payloadStr = JSON.stringify(payload);
    fs.writeFileSync(tempFile, payloadStr, 'utf-8');

    // Ejecutar curl usando el archivo temporal (timeout más largo para cargar todos los clientes)
    const cmd = `curl -s -X POST "${COLPPY_ENDPOINT}" -H "Content-Type: application/json" -d @"${tempFile}" --max-time 120 -L`;

    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 125000, // 125 segundos
      maxBuffer: 50 * 1024 * 1024, // 50MB para manejar muchos clientes
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
// CARGAR TODOS LOS CLIENTES
// ============================================================================

function loadAllCustomers(): CachedCustomer[] {
  // Si el cache es reciente, usar lo que hay
  if (customerCache.length > 0 && Date.now() - cacheTimestamp < CACHE_TTL) {
    return customerCache;
  }

  console.log('[Colppy] Cargando todos los clientes...');
  const startTime = Date.now();

  const claveSesion = getSession();
  const passwordMD5 = md5(COLPPY_PASSWORD);

  const response = callColppy({
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
    const newSession = getSession();

    const retry = callColppy({
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

    customerCache = mapCustomers(retry.response.data);
  } else {
    customerCache = mapCustomers(response.response.data);
  }

  cacheTimestamp = Date.now();
  const elapsed = Date.now() - startTime;
  console.log(`[Colppy] ${customerCache.length} clientes cargados en ${elapsed}ms`);

  return customerCache;
}

function mapCustomers(data: any[]): CachedCustomer[] {
  const condicionIvaMap: Record<string, string> = {
    '1': 'RESPONSABLE_INSCRIPTO',
    '2': 'MONOTRIBUTO',
    '4': 'EXENTO',
    '5': 'CONSUMIDOR_FINAL',
    '6': 'RESPONSABLE_NO_INSCRIPTO',
  };

  const condicionIvaDisplay: Record<string, string> = {
    '1': 'Resp. Inscripto',
    '2': 'Monotributo',
    '4': 'Exento',
    '5': 'Consumidor Final',
    '6': 'Resp. No Inscripto',
  };

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
    console.log('=== COLPPY CUSTOMER RAW FIELDS (primer cliente) ===');
    console.log(JSON.stringify(data[0], null, 2));
    console.log('=== FIN RAW FIELDS ===');
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

    return {
      id: c.idCliente,
      colppyId: c.idCliente,
      name,
      businessName,
      cuit,
      taxCondition: condicionIvaMap[c.idCondicionIva] || 'RESPONSABLE_INSCRIPTO',
      taxConditionDisplay: condicionIvaDisplay[c.idCondicionIva] || 'Resp. Inscripto',
      address: c.DirPostal || '',
      city: c.DirPostalCiudad || '',
      province: c.DirPostalProvincia || '',
      postalCode: c.DirPostalCodigoPostal || '',
      phone: c.Telefono || '',
      mobile: c.Celular || '',
      email: c.Email || '',
      saldo: parseFloat(c.Saldo || '0'),
      priceMultiplier: 1.0,
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
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get('search') || '').trim().toLowerCase();
    const limit = parseInt(searchParams.get('limit') || '20');
    const all = searchParams.get('all') === 'true';
    const id = searchParams.get('id') || '';

    // Cargar cache si es necesario (puede tardar ~2 seg la primera vez)
    const allCustomers = loadAllCustomers();

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
    console.error('Error buscando clientes:', error);
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
    console.log('[Colppy] Refrescando cache de clientes manualmente...');

    // Invalidar cache
    cacheTimestamp = 0;
    customerCache = [];

    // Recargar
    const customers = loadAllCustomers();

    return NextResponse.json({
      success: true,
      message: `Cache refrescado: ${customers.length} clientes cargados`,
      total: customers.length,
    });
  } catch (error: any) {
    console.error('Error refrescando cache:', error);
    return NextResponse.json(
      { error: error.message || 'Error al refrescar cache' },
      { status: 500 }
    );
  }
}

/**
 * API Endpoint: GET /api/colppy/facturas
 * Lista facturas de venta de un cliente desde Colppy
 *
 * Params: ?idCliente=XXX&fechaDesde=YYYY-MM-DD&fechaHasta=YYYY-MM-DD
 */

import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// CONFIGURACIÓN (misma que colppy/clientes)
// ============================================================================

const COLPPY_ENDPOINT = 'https://login.colppy.com/lib/frontera2/service.php';
const COLPPY_USER = process.env.COLPPY_USER || '';
const COLPPY_PASSWORD = process.env.COLPPY_PASSWORD || '';
const COLPPY_ID_EMPRESA = process.env.COLPPY_ID_EMPRESA || '';

function md5(text: string): string {
  return crypto.createHash('md5').update(text).digest('hex');
}

// ============================================================================
// CACHE POR CLIENTE
// ============================================================================

interface ColppyFactura {
  idFactura: string;
  numero: string;
  tipo: string;
  tipoComprobante: string;
  fecha: string;
  fechaVto: string;
  total: number;
  saldo: number;
  estado: string;
  moneda: string;
  tipoCambio: number;
  condicionPago: string;
  descripcion: string;
}

const facturaCache: Map<string, { data: ColppyFactura[]; timestamp: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

let cachedSession: { claveSesion: string; timestamp: number } | null = null;
const SESSION_TTL = 20 * 60 * 1000;

// ============================================================================
// FUNCIONES COLPPY
// ============================================================================

function callColppy(payload: any): any {
  let tempFile: string | null = null;
  try {
    tempFile = path.join(os.tmpdir(), `colppy-fact-${Date.now()}.json`);
    fs.writeFileSync(tempFile, JSON.stringify(payload), 'utf-8');
    const cmd = `curl -s -X POST "${COLPPY_ENDPOINT}" -H "Content-Type: application/json" -d @"${tempFile}" --max-time 30 -L`;
    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 35000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(result);
  } catch (error: any) {
    throw new Error(`Error llamando a Colppy: ${error.message}`);
  } finally {
    if (tempFile && fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
    }
  }
}

function getSession(): string {
  if (cachedSession && Date.now() - cachedSession.timestamp < SESSION_TTL) {
    return cachedSession.claveSesion;
  }
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
// MAPEO DE FACTURAS
// ============================================================================

function mapFacturas(data: any[]): ColppyFactura[] {
  return (data || []).map((f: any) => {
    const nro1 = f.nroFactura1 || f.NroFactura1 || '';
    const nro2 = f.nroFactura2 || f.NroFactura2 || '';
    const numero = nro1 && nro2 ? `${String(nro1).padStart(4, '0')}-${String(nro2).padStart(8, '0')}` : (f.nroFactura || f.NumeroFactura || '');

    return {
      idFactura: String(f.idFactura || f.id || ''),
      numero,
      tipo: f.idTipoFactura || f.TipoFactura || '',
      tipoComprobante: f.idTipoComprobante || f.TipoComprobante || '',
      fecha: f.fechaFactura || f.FechaFactura || '',
      fechaVto: f.fechaVto || f.FechaVto || '',
      total: parseFloat(f.totalFactura || f.TotalFactura || '0'),
      saldo: parseFloat(f.saldoFactura || f.SaldoFactura || f.totalFactura || f.TotalFactura || '0'),
      estado: f.idEstadoFactura || f.EstadoFactura || 'Pendiente',
      moneda: f.moneda || f.Moneda || 'Peso argentino',
      tipoCambio: parseFloat(f.tipoCambio || f.TipoCambio || '1'),
      condicionPago: f.idCondicionPago || f.CondicionPago || '',
      descripcion: f.descripcion || f.Descripcion || '',
    };
  });
}

// ============================================================================
// ENDPOINT
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const idCliente = searchParams.get('idCliente');

    if (!idCliente) {
      return NextResponse.json(
        { error: 'Se requiere idCliente', facturas: [] },
        { status: 400 }
      );
    }

    // Verificar cache
    const cached = facturaCache.get(idCliente);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({
        facturas: cached.data,
        total: cached.data.length,
        cached: true,
      });
    }

    console.log(`[Colppy] Cargando facturas para cliente ${idCliente}...`);
    const claveSesion = getSession();
    const passwordMD5 = md5(COLPPY_PASSWORD);

    // Construir filtros
    const filters: any[] = [
      { field: 'idCliente', op: '=', value: idCliente },
    ];

    const response = callColppy({
      auth: { usuario: COLPPY_USER, password: passwordMD5 },
      service: { provision: 'FacturaVenta', operacion: 'listar_facturaventa' },
      parameters: {
        sesion: { usuario: COLPPY_USER, claveSesion },
        idEmpresa: COLPPY_ID_EMPRESA,
        start: 0,
        limit: 1000,
        filter: filters,
        order: [{ field: 'fechaFactura', dir: 'desc' }],
      },
    });

    // Log de descubrimiento en primera llamada
    if (!facturaCache.has('_logged')) {
      console.log('[Colppy] Respuesta facturas (muestra):', JSON.stringify(response?.response?.data?.[0] || response?.response, null, 2).substring(0, 2000));
      facturaCache.set('_logged', { data: [], timestamp: Date.now() });
    }

    if (response.result?.estado !== 0 || !response.response?.success) {
      // Reintentar con nueva sesión
      cachedSession = null;
      const newSession = getSession();
      const retry = callColppy({
        auth: { usuario: COLPPY_USER, password: md5(COLPPY_PASSWORD) },
        service: { provision: 'FacturaVenta', operacion: 'listar_facturaventa' },
        parameters: {
          sesion: { usuario: COLPPY_USER, claveSesion: newSession },
          idEmpresa: COLPPY_ID_EMPRESA,
          start: 0,
          limit: 1000,
          filter: filters,
          order: [{ field: 'fechaFactura', dir: 'desc' }],
        },
      });

      if (retry.result?.estado !== 0) {
        throw new Error(retry.result?.mensaje || 'Error cargando facturas');
      }

      const facturas = mapFacturas(retry.response?.data || []);
      facturaCache.set(idCliente, { data: facturas, timestamp: Date.now() });
      return NextResponse.json({ facturas, total: facturas.length, cached: false });
    }

    const facturas = mapFacturas(response.response?.data || []);
    facturaCache.set(idCliente, { data: facturas, timestamp: Date.now() });

    console.log(`[Colppy] ${facturas.length} facturas cargadas para cliente ${idCliente}`);

    return NextResponse.json({ facturas, total: facturas.length, cached: false });
  } catch (error: any) {
    console.error('Error fetching Colppy facturas:', error);
    return NextResponse.json(
      { error: error.message || 'Error al cargar facturas', facturas: [] },
      { status: 500 }
    );
  }
}

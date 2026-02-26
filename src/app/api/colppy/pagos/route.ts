/**
 * API Endpoint: GET /api/colppy/pagos
 * Lista recibos/pagos de un cliente desde Colppy
 *
 * Params: ?idCliente=XXX
 */

import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

interface ColppyPago {
  idRecibo: string;
  numero: string;
  fecha: string;
  monto: number;
  moneda: string;
  medioPago: string;
  facturaAsociada: string;
  descripcion: string;
}

const pagoCache: Map<string, { data: ColppyPago[]; timestamp: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000;

let cachedSession: { claveSesion: string; timestamp: number } | null = null;
const SESSION_TTL = 20 * 60 * 1000;

function callColppy(payload: any): any {
  let tempFile: string | null = null;
  try {
    tempFile = path.join(os.tmpdir(), `colppy-pago-${Date.now()}.json`);
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
// MAPEO DE PAGOS
// ============================================================================

function mapPagos(data: any[]): ColppyPago[] {
  return (data || []).map((p: any) => {
    const nro1 = p.nroRecibo1 || p.NroRecibo1 || p.nroFactura1 || '';
    const nro2 = p.nroRecibo2 || p.NroRecibo2 || p.nroFactura2 || '';
    const numero = nro1 && nro2
      ? `${String(nro1).padStart(4, '0')}-${String(nro2).padStart(8, '0')}`
      : (p.nroRecibo || p.NumeroRecibo || p.numero || '');

    return {
      idRecibo: String(p.idRecibo || p.id || ''),
      numero,
      fecha: p.fechaRecibo || p.FechaRecibo || p.fecha || '',
      monto: parseFloat(p.totalRecibo || p.TotalRecibo || p.monto || p.total || '0'),
      moneda: p.moneda || p.Moneda || 'Peso argentino',
      medioPago: p.medioPago || p.MedioPago || p.formaPago || p.FormaPago || '',
      facturaAsociada: p.facturaAsociada || p.nroFacturaAsociada || '',
      descripcion: p.descripcion || p.Descripcion || p.observaciones || '',
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
        { error: 'Se requiere idCliente', pagos: [] },
        { status: 400 }
      );
    }

    // Verificar cache
    const cached = pagoCache.get(idCliente);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({
        pagos: cached.data,
        total: cached.data.length,
        cached: true,
      });
    }

    console.log(`[Colppy] Cargando pagos para cliente ${idCliente}...`);
    const claveSesion = getSession();
    const passwordMD5 = md5(COLPPY_PASSWORD);

    const filters = [
      { field: 'idCliente', op: '=', value: idCliente },
    ];

    // Intentar con listar_recibo primero
    let response: any;
    let operacion = 'listar_recibo';

    try {
      response = callColppy({
        auth: { usuario: COLPPY_USER, password: passwordMD5 },
        service: { provision: 'Recibo', operacion },
        parameters: {
          sesion: { usuario: COLPPY_USER, claveSesion },
          idEmpresa: COLPPY_ID_EMPRESA,
          start: 0,
          limit: 500,
          filter: filters,
          order: [{ field: 'fechaRecibo', dir: 'desc' }],
        },
      });
    } catch {
      // Si falla, intentar con Cobranza
      operacion = 'listar_cobranza';
      response = callColppy({
        auth: { usuario: COLPPY_USER, password: passwordMD5 },
        service: { provision: 'Cobranza', operacion },
        parameters: {
          sesion: { usuario: COLPPY_USER, claveSesion },
          idEmpresa: COLPPY_ID_EMPRESA,
          start: 0,
          limit: 500,
          filter: filters,
          order: [{ field: 'fecha', dir: 'desc' }],
        },
      });
    }

    // Log de descubrimiento
    if (!pagoCache.has('_logged')) {
      console.log(`[Colppy] Respuesta pagos (${operacion}, muestra):`, JSON.stringify(response?.response?.data?.[0] || response?.response, null, 2).substring(0, 2000));
      pagoCache.set('_logged', { data: [], timestamp: Date.now() });
    }

    if (response.result?.estado !== 0 || !response.response?.success) {
      // Reintentar con nueva sesión
      cachedSession = null;
      const newSession = getSession();
      response = callColppy({
        auth: { usuario: COLPPY_USER, password: md5(COLPPY_PASSWORD) },
        service: { provision: 'Recibo', operacion: 'listar_recibo' },
        parameters: {
          sesion: { usuario: COLPPY_USER, claveSesion: newSession },
          idEmpresa: COLPPY_ID_EMPRESA,
          start: 0,
          limit: 500,
          filter: filters,
          order: [{ field: 'fechaRecibo', dir: 'desc' }],
        },
      });
    }

    const pagos = mapPagos(response?.response?.data || []);
    pagoCache.set(idCliente, { data: pagos, timestamp: Date.now() });

    console.log(`[Colppy] ${pagos.length} pagos cargados para cliente ${idCliente}`);

    return NextResponse.json({ pagos, total: pagos.length, cached: false });
  } catch (error: any) {
    console.error('Error fetching Colppy pagos:', error);
    return NextResponse.json(
      { error: error.message || 'Error al cargar pagos', pagos: [] },
      { status: 500 }
    );
  }
}

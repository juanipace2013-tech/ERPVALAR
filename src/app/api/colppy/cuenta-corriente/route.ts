/**
 * API Endpoint: GET /api/colppy/cuenta-corriente
 * Estado de cuenta corriente de un cliente desde Colppy.
 *
 * Estrategia: combina facturas + pagos para armar el listado de movimientos
 * con saldo acumulado. El saldo total viene del cache de clientes.
 *
 * Params: ?idCliente=XXX&cuit=XXXXXXXXXXX
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

interface CCMovimiento {
  fecha: string;
  tipo: string;
  comprobante: string;
  debe: number;
  haber: number;
  saldo: number;
}

const ccCache: Map<string, { data: { saldo: number; movimientos: CCMovimiento[] }; timestamp: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000;

let cachedSession: { claveSesion: string; timestamp: number } | null = null;
const SESSION_TTL = 20 * 60 * 1000;

function callColppy(payload: any): any {
  let tempFile: string | null = null;
  try {
    tempFile = path.join(os.tmpdir(), `colppy-cc-${Date.now()}.json`);
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

function parseColppyDate(dateStr: string): Date {
  if (!dateStr) return new Date(0);
  // Colppy puede retornar DD-MM-YYYY o YYYY-MM-DD
  if (dateStr.match(/^\d{2}-\d{2}-\d{4}$/)) {
    const [dd, mm, yyyy] = dateStr.split('-');
    return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
  }
  return new Date(dateStr);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const idCliente = searchParams.get('idCliente');

    if (!idCliente) {
      return NextResponse.json(
        { error: 'Se requiere idCliente', saldo: 0, movimientos: [] },
        { status: 400 }
      );
    }

    // Verificar cache
    const cached = ccCache.get(idCliente);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({ ...cached.data, cached: true });
    }

    console.log(`[Colppy] Cargando cuenta corriente para cliente ${idCliente}...`);
    const claveSesion = getSession();
    const passwordMD5 = md5(COLPPY_PASSWORD);

    const filters = [
      { field: 'idCliente', op: '=', value: idCliente },
    ];

    // Obtener facturas
    let facturasData: any[] = [];
    try {
      const facResp = callColppy({
        auth: { usuario: COLPPY_USER, password: passwordMD5 },
        service: { provision: 'FacturaVenta', operacion: 'listar_facturaventa' },
        parameters: {
          sesion: { usuario: COLPPY_USER, claveSesion },
          idEmpresa: COLPPY_ID_EMPRESA,
          start: 0,
          limit: 1000,
          filter: filters,
          order: [{ field: 'fechaFactura', dir: 'asc' }],
        },
      });
      if (facResp.response?.data) {
        facturasData = facResp.response.data;
      }
    } catch (e: any) {
      console.warn('[Colppy CC] Error cargando facturas:', e.message);
    }

    // Obtener pagos/recibos
    let pagosData: any[] = [];
    try {
      const pagResp = callColppy({
        auth: { usuario: COLPPY_USER, password: passwordMD5 },
        service: { provision: 'Recibo', operacion: 'listar_recibo' },
        parameters: {
          sesion: { usuario: COLPPY_USER, claveSesion },
          idEmpresa: COLPPY_ID_EMPRESA,
          start: 0,
          limit: 500,
          filter: filters,
          order: [{ field: 'fechaRecibo', dir: 'asc' }],
        },
      });
      if (pagResp.response?.data) {
        pagosData = pagResp.response.data;
      }
    } catch (e: any) {
      console.warn('[Colppy CC] Error cargando pagos:', e.message);
    }

    // Convertir facturas a movimientos (DEBE)
    const movimientos: CCMovimiento[] = [];

    for (const f of facturasData) {
      const nro1 = f.nroFactura1 || f.NroFactura1 || '';
      const nro2 = f.nroFactura2 || f.NroFactura2 || '';
      const numero = nro1 && nro2
        ? `${String(nro1).padStart(4, '0')}-${String(nro2).padStart(8, '0')}`
        : (f.nroFactura || '');
      const tipo = f.idTipoFactura || f.TipoFactura || '';
      const tipoComp = f.idTipoComprobante || '';

      // Notas de crédito van al haber, facturas al debe
      const isNotaCredito = tipoComp === '6' || tipoComp === '8' || tipoComp === '13';
      const total = parseFloat(f.totalFactura || f.TotalFactura || '0');

      movimientos.push({
        fecha: f.fechaFactura || f.FechaFactura || '',
        tipo: isNotaCredito ? `NC ${tipo}` : `Factura ${tipo}`,
        comprobante: numero,
        debe: isNotaCredito ? 0 : total,
        haber: isNotaCredito ? total : 0,
        saldo: 0, // Se calcula después
      });
    }

    // Convertir pagos a movimientos (HABER)
    for (const p of pagosData) {
      const nro1 = p.nroRecibo1 || p.NroRecibo1 || '';
      const nro2 = p.nroRecibo2 || p.NroRecibo2 || '';
      const numero = nro1 && nro2
        ? `${String(nro1).padStart(4, '0')}-${String(nro2).padStart(8, '0')}`
        : (p.nroRecibo || p.numero || '');

      movimientos.push({
        fecha: p.fechaRecibo || p.FechaRecibo || p.fecha || '',
        tipo: 'Recibo',
        comprobante: numero,
        debe: 0,
        haber: parseFloat(p.totalRecibo || p.TotalRecibo || p.monto || '0'),
        saldo: 0,
      });
    }

    // Ordenar por fecha (más antiguo primero) y calcular saldo acumulado
    movimientos.sort((a, b) => {
      const dateA = parseColppyDate(a.fecha);
      const dateB = parseColppyDate(b.fecha);
      return dateA.getTime() - dateB.getTime();
    });

    let saldoAcumulado = 0;
    for (const mov of movimientos) {
      saldoAcumulado += mov.debe - mov.haber;
      mov.saldo = saldoAcumulado;
    }

    // Invertir para mostrar más recientes primero
    movimientos.reverse();

    const result = {
      saldo: saldoAcumulado,
      movimientos,
      totalFacturas: facturasData.length,
      totalPagos: pagosData.length,
    };

    ccCache.set(idCliente, { data: result, timestamp: Date.now() });
    console.log(`[Colppy CC] ${movimientos.length} movimientos para cliente ${idCliente}, saldo: ${saldoAcumulado}`);

    return NextResponse.json({ ...result, cached: false });
  } catch (error: any) {
    console.error('Error fetching Colppy cuenta corriente:', error);
    return NextResponse.json(
      { error: error.message || 'Error al cargar cuenta corriente', saldo: 0, movimientos: [] },
      { status: 500 }
    );
  }
}

/**
 * API Endpoint: GET /api/colppy/cuenta-corriente
 * Estado de cuenta corriente de un cliente desde Colppy.
 *
 * ESTRATEGIA: Solo usa facturas (listar_facturasventa).
 * - Facturas (tipoComprobante "4","5") → movimiento DEBE
 * - Notas de crédito (tipoComprobante "6") → movimiento HABER
 * - Cobros (totalaplicado de cada factura) → movimiento HABER
 * El saldo se calcula acumulando debe - haber cronológicamente.
 *
 * NOTA: Colppy NO tiene endpoint de recibos/cobros separado.
 * Los cobros se infieren del campo totalaplicado de cada factura.
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

interface CCMovimiento {
  fecha: string;
  tipo: string;
  comprobante: string;
  debe: number;
  haber: number;
  saldo: number;
}

const ccCache: Map<string, { data: { saldo: number; movimientos: CCMovimiento[]; totalFacturas: number; totalPagos: number }; timestamp: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000;

let cachedSession: { claveSesion: string; timestamp: number } | null = null;
const SESSION_TTL = 20 * 60 * 1000;

function callColppy(payload: any): any {
  let tempFile: string | null = null;
  try {
    tempFile = path.join(os.tmpdir(), `colppy-cc-${Date.now()}.json`);
    fs.writeFileSync(tempFile, JSON.stringify(payload), 'utf-8');
    const cmd = `curl -s -X POST "${COLPPY_ENDPOINT}" -H "Content-Type: application/json" -d @"${tempFile}" --max-time 60 -L`;
    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 65000,
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

// Mapeos
const tipoFacturaMap: Record<string, string> = {
  '0': 'A', '1': 'B', '2': 'C', '3': 'E',
};

function parseColppyDate(dateStr: string): Date {
  if (!dateStr) return new Date(0);
  // Colppy usa YYYY-MM-DD para fechaFactura
  return new Date(dateStr);
}

function buildMovimientosFromFacturas(facturasData: any[]): {
  movimientos: CCMovimiento[];
  saldo: number;
  totalFacturas: number;
  totalPagos: number;
} {
  const movimientos: CCMovimiento[] = [];
  let totalFacturas = 0;
  let totalPagos = 0;

  for (const f of facturasData) {
    const tipoComp = f.idTipoComprobante || '4';
    const tipoLetra = tipoFacturaMap[f.idTipoFactura] || 'A';
    const total = parseFloat(f.totalFactura || '0');
    const aplicado = parseFloat(f.totalaplicado || '0');
    const numero = f.nroFactura || '';

    const isNotaCredito = ['6', '8', '13'].includes(tipoComp);

    if (isNotaCredito) {
      // NC → movimiento HABER (reduce deuda)
      movimientos.push({
        fecha: f.fechaFactura || '',
        tipo: `NC ${tipoLetra}`,
        comprobante: numero,
        debe: 0,
        haber: total,
        saldo: 0,
      });
    } else {
      // Factura/ND → movimiento DEBE
      totalFacturas++;
      movimientos.push({
        fecha: f.fechaFactura || '',
        tipo: `Factura ${tipoLetra}`,
        comprobante: numero,
        debe: total,
        haber: 0,
        saldo: 0,
      });

      // Si hay cobro (totalaplicado > 0), agregar movimiento HABER
      if (aplicado > 0) {
        totalPagos++;
        // Fecha del cobro: usar record_update_ts si es posterior a fechaFactura
        const fechaCobro = f.record_update_ts
          ? f.record_update_ts.split(' ')[0]
          : f.fechaFactura || '';

        movimientos.push({
          fecha: fechaCobro,
          tipo: 'Cobro',
          comprobante: numero,
          debe: 0,
          haber: aplicado,
          saldo: 0,
        });
      }
    }
  }

  // Ordenar por fecha asc (más antiguo primero) para calcular saldo acumulado
  movimientos.sort((a, b) => {
    const dateA = parseColppyDate(a.fecha);
    const dateB = parseColppyDate(b.fecha);
    if (dateA.getTime() !== dateB.getTime()) return dateA.getTime() - dateB.getTime();
    // Dentro del mismo día: facturas primero, cobros después
    if (a.debe > 0 && b.haber > 0) return -1;
    if (a.haber > 0 && b.debe > 0) return 1;
    return 0;
  });

  let saldoAcumulado = 0;
  for (const mov of movimientos) {
    saldoAcumulado += mov.debe - mov.haber;
    mov.saldo = Math.round(saldoAcumulado * 100) / 100; // Redondear a 2 decimales
  }

  // Invertir para mostrar más recientes primero
  movimientos.reverse();

  return {
    movimientos,
    saldo: Math.round(saldoAcumulado * 100) / 100,
    totalFacturas,
    totalPagos,
  };
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

    // Solo necesitamos facturas — los cobros se derivan de totalaplicado
    let response = callColppy({
      auth: { usuario: COLPPY_USER, password: passwordMD5 },
      service: { provision: 'FacturaVenta', operacion: 'listar_facturasventa' },
      parameters: {
        sesion: { usuario: COLPPY_USER, claveSesion },
        idEmpresa: COLPPY_ID_EMPRESA,
        start: 0,
        limit: 1000,
        filter: [{ field: 'idCliente', op: '=', value: idCliente }],
        order: { field: ['idFactura'], order: 'desc' },
      },
    });

    if (response.result?.estado !== 0 || !response.response?.success) {
      // Reintentar con nueva sesión
      cachedSession = null;
      const newSession = getSession();
      response = callColppy({
        auth: { usuario: COLPPY_USER, password: md5(COLPPY_PASSWORD) },
        service: { provision: 'FacturaVenta', operacion: 'listar_facturasventa' },
        parameters: {
          sesion: { usuario: COLPPY_USER, claveSesion: newSession },
          idEmpresa: COLPPY_ID_EMPRESA,
          start: 0,
          limit: 1000,
          filter: [{ field: 'idCliente', op: '=', value: idCliente }],
          order: { field: ['idFactura'], order: 'desc' },
        },
      });

      if (response.result?.estado !== 0) {
        throw new Error(response.result?.mensaje || 'Error cargando facturas para cuenta corriente');
      }
    }

    const result = buildMovimientosFromFacturas(response.response?.data || []);

    ccCache.set(idCliente, { data: result, timestamp: Date.now() });
    console.log(`[Colppy CC] ${result.movimientos.length} movimientos para cliente ${idCliente}, saldo: ${result.saldo}`);

    return NextResponse.json({ ...result, cached: false });
  } catch (error: any) {
    console.error('Error fetching Colppy cuenta corriente:', error);
    return NextResponse.json(
      { error: error.message || 'Error al cargar cuenta corriente', saldo: 0, movimientos: [] },
      { status: 500 }
    );
  }
}

/**
 * API Endpoint: GET /api/colppy/pagos
 * Lista pagos/cobros de un cliente desde Colppy
 *
 * NOTA: Colppy NO tiene endpoint separado de recibos/cobros de clientes.
 * Las provisiones Recibo, Cobranza, CobroCliente NO existen en esta API.
 *
 * ESTRATEGIA: Derivar pagos de las facturas que tienen totalaplicado > 0.
 * Una factura con totalaplicado > 0 indica que se registró un cobro.
 * Si totalaplicado == totalFactura, la factura está completamente pagada.
 * Las notas de crédito (idTipoComprobante "6") se muestran como ajustes.
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

// ============================================================================
// MAPEO
// ============================================================================

const monedaMap: Record<string, string> = {
  '0': 'USD', '1': 'ARS', '2': 'EUR',
};

const tipoFacturaMap: Record<string, string> = {
  '0': 'A', '1': 'B', '2': 'C', '3': 'E',
};

function derivePagosFromFacturas(facturasData: any[]): ColppyPago[] {
  const pagos: ColppyPago[] = [];

  for (const f of facturasData) {
    const aplicado = parseFloat(f.totalaplicado || '0');
    if (aplicado <= 0) continue;

    const tipoComp = f.idTipoComprobante || '4';
    const tipoLetra = tipoFacturaMap[f.idTipoFactura] || 'A';
    const moneda = monedaMap[f.idMoneda] || 'ARS';
    const total = parseFloat(f.totalFactura || '0');

    // Notas de crédito son ajustes/compensaciones
    const isNotaCredito = ['6', '8', '13'].includes(tipoComp);

    if (isNotaCredito) {
      // NC con totalaplicado > 0 significa que se aplicó como pago
      pagos.push({
        idRecibo: `nc-${f.idFactura}`,
        numero: f.nroFactura || '',
        fecha: f.record_update_ts ? f.record_update_ts.split(' ')[0] : f.fechaFactura || '',
        monto: aplicado,
        moneda,
        medioPago: 'Nota de Crédito',
        facturaAsociada: `NC ${tipoLetra} ${f.nroFactura || ''}`,
        descripcion: `Nota de Crédito ${tipoLetra} ${f.nroFactura} aplicada`,
      });
      continue;
    }

    // Facturas con cobros
    const isParcial = aplicado < total * 0.999; // margen para redondeo

    // Usar record_update_ts como fecha aprox de cobro
    const fechaPago = f.record_update_ts
      ? f.record_update_ts.split(' ')[0]
      : f.fechaFactura || '';

    pagos.push({
      idRecibo: `pago-${f.idFactura}`,
      numero: f.nroFactura || '',
      fecha: fechaPago,
      monto: aplicado,
      moneda,
      medioPago: isParcial ? 'Pago parcial' : 'Pago total',
      facturaAsociada: `FC ${tipoLetra} ${f.nroFactura || ''}`,
      descripcion: isParcial
        ? `Cobro parcial FC ${tipoLetra} ${f.nroFactura}`
        : `Cobro total FC ${tipoLetra} ${f.nroFactura}`,
    });
  }

  // Ordenar por fecha desc
  pagos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

  return pagos;
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
        throw new Error(response.result?.mensaje || 'Error cargando facturas para derivar pagos');
      }
    }

    const pagos = derivePagosFromFacturas(response.response?.data || []);
    pagoCache.set(idCliente, { data: pagos, timestamp: Date.now() });

    console.log(`[Colppy] ${pagos.length} pagos derivados para cliente ${idCliente}`);

    return NextResponse.json({ pagos, total: pagos.length, cached: false });
  } catch (error: any) {
    console.error('Error fetching Colppy pagos:', error);
    return NextResponse.json(
      { error: error.message || 'Error al cargar pagos', pagos: [] },
      { status: 500 }
    );
  }
}

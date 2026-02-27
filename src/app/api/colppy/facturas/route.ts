/**
 * API Endpoint: GET /api/colppy/facturas
 * Lista facturas de venta de un cliente desde Colppy
 *
 * Campos reales de Colppy (descubiertos vía debug):
 * - idFactura, nroFactura (ya formateado "0003-00013881")
 * - idTipoFactura ("0"=A, etc), idTipoComprobante ("4"=Factura, "5"=ND, "6"=NC)
 * - fechaFactura (YYYY-MM-DD), fechaPago (fecha vencimiento, YYYY-MM-DD)
 * - totalFactura, totalaplicado (monto pagado)
 * - idEstadoFactura ("3"=pendiente, "5"=pagada)
 * - idCondicionPago ("0"=contado, "30"=30 días, etc)
 * - idMoneda ("1"=pesos), valorCambio, rate
 * - netoGravado, totalIVA, cae, fechaFe
 *
 * Saldo = totalFactura - totalaplicado (no existe campo saldo separado)
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

interface ColppyFactura {
  idFactura: string;
  numero: string;
  tipo: string;           // "A", "B", "C", etc.
  tipoComprobante: string; // "4"=Factura, "5"=ND, "6"=NC
  tipoLabel: string;       // "FAV A", "NCV A", "NDV A", "REC"
  fecha: string;           // fechaFactura
  fechaVto: string;        // fechaPago (vencimiento)
  total: number;
  cobrado: number;         // totalaplicado
  saldo: number;           // totalFactura - totalaplicado
  estado: string;          // "Pagada", "Pendiente", "Vencida"
  moneda: string;
  monedaLabel: string;     // "ARS", "USD", etc.
  tipoCambio: number;
  valorME: number;         // Valor en moneda extranjera (total / tipoCambio si USD)
  condicionPago: string;
  descripcion: string;
  cae: string;
  netoGravado: number;
  totalIVA: number;
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
// MAPEO DE FACTURAS (campos reales de Colppy)
// ============================================================================

// Mapeo de idTipoFactura a letra
const tipoFacturaMap: Record<string, string> = {
  '0': 'A',
  '1': 'B',
  '2': 'C',
  '3': 'E',
  '4': 'M',
  '5': 'T',
};

// Mapeo de idMoneda
const monedaMap: Record<string, string> = {
  '0': 'USD',
  '1': 'ARS',
  '2': 'EUR',
};

// Mapeo condición de pago
const condicionPagoMap: Record<string, string> = {
  '0': 'Contado',
  '7': 'a 7 Días',
  '15': 'a 15 Días',
  '30': 'a 30 Días',
  '45': 'a 45 Días',
  '60': 'a 60 Días',
  '90': 'a 90 Días',
  '120': 'a 120 Días',
};

// Mapeo tipoComprobante a label legible (como muestra Colppy)
// 4=Factura Venta (FAV), 5=Nota Débito Venta (NDV), 6=Nota Crédito Venta (NCV)
const tipoComprobanteLabel: Record<string, string> = {
  '4': 'FAV', '5': 'NDV', '6': 'NCV', '7': 'REC', '8': 'NCV', '9': 'NDV',
  '10': 'FAV', '11': 'NDV', '12': 'NCV', '13': 'NCV',
};

function mapFacturas(data: any[]): ColppyFactura[] {
  return (data || []).map((f: any) => {
    const total = parseFloat(f.totalFactura || '0');
    const aplicado = parseFloat(f.totalaplicado || '0');
    const saldo = Math.max(0, total - aplicado);

    // Determinar estado basado en datos reales
    // idEstadoFactura: "3"=pendiente, "5"=pagada/cobrada
    let estado = 'Pendiente';
    if (f.idEstadoFactura === '5' || saldo <= 0) {
      estado = 'Pagada';
    }

    const tipoLetra = tipoFacturaMap[f.idTipoFactura] || 'A';
    const tipoComp = f.idTipoComprobante || '4';
    const compLabel = tipoComprobanteLabel[tipoComp] || 'FAV';
    const monedaCode = monedaMap[f.idMoneda] || 'ARS';
    const tipoCambio = parseFloat(f.rate || f.valorCambio || '1');

    // Calcular valor en moneda extranjera
    // Si es USD (idMoneda=0) el rate es el tipo de cambio, el valor ME es total/rate
    // Si es ARS (idMoneda=1) no hay valor ME relevante
    const valorME = monedaCode === 'USD' ? total : (tipoCambio > 1 ? Math.round((total / tipoCambio) * 100) / 100 : 0);

    return {
      idFactura: String(f.idFactura || ''),
      numero: f.nroFactura || '',
      tipo: tipoLetra,
      tipoComprobante: tipoComp,
      tipoLabel: `${compLabel} ${tipoLetra}`,
      fecha: f.fechaFactura || '',
      fechaVto: f.fechaPago || f.fechaFactura || '',
      total,
      cobrado: aplicado,
      saldo,
      estado,
      moneda: monedaCode,
      monedaLabel: monedaCode,
      tipoCambio,
      valorME,
      condicionPago: condicionPagoMap[f.idCondicionPago] || f.idCondicionPago || '',
      descripcion: f.descripcion || '',
      cae: f.cae || '',
      netoGravado: parseFloat(f.netoGravado || '0'),
      totalIVA: parseFloat(f.totalIVA || '0'),
    };
  });
}

// ============================================================================
// ENDPOINT
// ============================================================================

function fetchFacturasFromColppy(claveSesion: string, passwordMD5: string, idCliente: string): any {
  return callColppy({
    auth: { usuario: COLPPY_USER, password: passwordMD5 },
    service: { provision: 'FacturaVenta', operacion: 'listar_facturasventa' },
    parameters: {
      sesion: { usuario: COLPPY_USER, claveSesion },
      idEmpresa: COLPPY_ID_EMPRESA,
      start: 0,
      limit: 1000,
      filter: [
        { field: 'idCliente', op: '=', value: idCliente },
      ],
      order: { field: ['idFactura'], order: 'desc' },
    },
  });
}

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

    let response = fetchFacturasFromColppy(claveSesion, passwordMD5, idCliente);

    if (response.result?.estado !== 0 || !response.response?.success) {
      // Reintentar con nueva sesión
      cachedSession = null;
      const newSession = getSession();
      response = fetchFacturasFromColppy(newSession, md5(COLPPY_PASSWORD), idCliente);

      if (response.result?.estado !== 0) {
        throw new Error(response.result?.mensaje || 'Error cargando facturas');
      }
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

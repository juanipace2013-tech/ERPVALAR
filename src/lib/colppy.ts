/**
 * Módulo de integración con la API de Colppy
 * Sistema contable para automatizar la creación de remitos y facturas
 *
 * IMPORTANTE: Colppy requiere estructura específica:
 * - auth: { usuario, password (MD5) }
 * - service: { provision, operacion }
 * - parameters: { sesion: { usuario, claveSesion }, ...params }
 */

import * as crypto from 'crypto';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

// ============================================================================
// CONFIGURACIÓN
// ============================================================================

const COLPPY_ENDPOINT = 'https://login.colppy.com/lib/frontera2/service.php';

export function getColppyConfig() {
  const user = process.env.COLPPY_USER;
  const password = process.env.COLPPY_PASSWORD;
  const idEmpresa = process.env.COLPPY_ID_EMPRESA;

  if (!user || !password || !idEmpresa) {
    throw new Error(
      'Faltan variables de entorno de Colppy: COLPPY_USER, COLPPY_PASSWORD, COLPPY_ID_EMPRESA'
    );
  }

  return { user, password, idEmpresa };
}

/**
 * Genera hash MD5 de un texto
 */
export function md5Hash(text: string): string {
  return crypto.createHash('md5').update(text).digest('hex');
}

// ============================================================================
// TIPOS
// ============================================================================

export interface ColppySession {
  claveSesion: string;
  usuario: string;
  idEmpresa: string;
}

export interface ColppyCustomer {
  idEntidad: string;
  razonSocial: string;
  cuit: string;
  condicionIva: string;
  idCondicionPago?: string;
}

/**
 * Datos que sendQuoteToColppy ya calculó para la factura (con la misma lógica
 * que va a Colppy) y que entrega al emisor externo (ARCA) para pedir el CAE.
 */
export interface EmisionExternaDatos {
  tipoFactura: 'A' | 'B';
  netoGravado: number;
  totalIVA: number;
  totalFactura: number;
  currency: string; // 'USD' | 'ARS'
  exchangeRate: number | null;
  fechaFactura: Date;
  fechaVto: Date;
  idCondicionPago: string;
  descripcion: string;
}

/** Resultado del emisor externo: número real + CAE ya autorizado. */
export interface EmisionExternaResultado {
  puntoVenta: number; // 7
  numero: number; // correlativo dentro del PV
  numeroFormateado: string; // 0007-00000001
  cbteTipo: number;
  cae: string;
  caeVencimiento: Date;
}

export interface SendToColppyOptions {
  action: 'remito' | 'factura-cuenta-corriente' | 'factura-contado' | 'remito-factura';
  condicionPago?: string;
  puntoVenta?: string;
  descripcion?: string;
  /**
   * Si está presente, la factura NO se crea como borrador para que Colppy la
   * emita: primero se llama a este hook (que emite en ARCA y devuelve número +
   * CAE) y después se carga en Colppy como APROBADA no-electrónica con ese
   * número, para que mueva CC, stock y asientos sin tocar ARCA.
   * Si el hook lanza, no se crea nada en Colppy.
   */
  emisionExterna?: (datos: EmisionExternaDatos) => Promise<EmisionExternaResultado>;
}

export interface SendToColppyResult {
  success: boolean;
  remitoId?: string;
  remitoNumber?: string;
  facturaId?: string;
  facturaNumber?: string;
  error?: string;
  /** En qué etapa falló: 'arca' (rechazo/errores al emitir) o 'colppy' (resto). */
  errorStage?: 'arca' | 'colppy';
  customerPaymentTermsDays?: number; // Días de pago del cliente en Colppy, para sincronizar a DB local
  /** Presente cuando se emitió con emisor externo (aunque Colppy haya fallado después). */
  emision?: EmisionExternaResultado;
  /** Payload de alta_facturaventa enviado a Colppy (para reintentar si falló). */
  colppyInvoicePayload?: ColppyInvoicePayload;
}

/** Error lanzado por el hook de emisión externa (rechazo de ARCA). */
export class EmisionExternaError extends Error {
  readonly stage = 'arca' as const;
  constructor(message: string, public readonly detalles?: unknown) {
    super(message);
    this.name = 'EmisionExternaError';
  }
}

// ============================================================================
// LLAMADA A API DE COLPPY
// ============================================================================

/**
 * Error específico para sesión expirada de Colppy.
 * Se lanza cuando la API devuelve HTML (página de login) en vez de JSON.
 */
export class ColppySessionExpiredError extends Error {
  constructor(preview: string) {
    super(`Sesión de Colppy expirada. Respuesta HTML recibida: ${preview.substring(0, 200)}`);
    this.name = 'ColppySessionExpiredError';
  }
}

/**
 * Error específico para rate limit (HTTP 429) de Colppy, lanzado cuando se
 * agotaron los reintentos del wrapper. Los callers con retry propio por
 * sesión expirada NO deben reintentar este error (re-loguearse no ayuda).
 */
export class ColppyRateLimitError extends Error {
  constructor() {
    super('Colppy rate limit alcanzado. Esperá unos minutos y reintentá.');
    this.name = 'ColppyRateLimitError';
  }
}

// Rate limit de Colppy (vigente desde 24/06/2026): 300 req / 5 min y 60 req/min.
// Al superarlo devuelve HTTP 429 con header Retry-After en segundos.
const RATE_LIMIT_MAX_RETRIES = 3;
// Backoff exponencial si el 429 viene sin Retry-After: 5s, 15s, 45s.
const RATE_LIMIT_BACKOFF_MS = [5_000, 15_000, 45_000];

// Pausa sugerida entre bloques en loops de paginación (syncs masivos).
// 1.100ms ≈ 54 req/min máximo, abajo del límite de 60/min incluso con
// algo de uso concurrente. Exportada para que los syncs la usen.
export const COLPPY_PAGE_THROTTLE_MS = 1_100;

// Espera no bloqueante (NUNCA usar sleep síncrono acá: congelaría el ERP).
export const colppySleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Tamaño de página para listados completos (clientes, etc.). Colppy corta la
// respuesta en el `limit` pedido, así que un limit fijo (ej. 6000) silenciosamente
// pierde registros cuando la empresa lo supera — pasó con >6000 clientes: ZAPOR
// y todo lo alfabéticamente posterior al corte desaparecían del ERP.
export const COLPPY_LIST_PAGE_SIZE = 3000;

/**
 * Trae TODAS las páginas de un listado de Colppy iterando start/limit hasta
 * que una página venga incompleta. El caller provee `fetchPage`, que hace la
 * llamada real (con su propio manejo de sesión/retry) y devuelve los registros
 * de esa página.
 */
export async function fetchAllColppyPages<T>(
  fetchPage: (start: number, limit: number) => Promise<T[]>,
  pageSize = COLPPY_LIST_PAGE_SIZE
): Promise<T[]> {
  const all: T[] = [];
  let start = 0;
  while (true) {
    const page = await fetchPage(start, pageSize);
    all.push(...page);
    if (page.length < pageSize) break;
    start += pageSize;
    await colppySleep(COLPPY_PAGE_THROTTLE_MS);
  }
  return all;
}

/**
 * Realiza una llamada a la API de Colppy usando fetch() nativo.
 *
 * Orden de manejo de errores:
 *   1. HTTP 429 (rate limit) → espera Retry-After + 1s (o backoff 5/15/45s)
 *      y reintenta hasta 3 veces. Si persiste, ColppyRateLimitError.
 *   2. Respuesta HTML / vacía / no-JSON (sesión expirada) → ColppySessionExpiredError
 *      (el re-login y retry lo manejan los callers, como hasta ahora).
 *   3. result.estado !== 0 → Error con el mensaje de Colppy
 *      (omitible con opts.throwOnEstadoError=false para callers que chequean
 *      estado a mano, p.ej. los syncs con retry de sesión propio).
 *
 * Migrado desde execSync(curl) para mayor confiabilidad:
 * - Sin archivos temporales
 * - Sin bloqueo del event loop
 * - Sin límites de tamaño de comando
 * - Manejo correcto de redirects
 */
export async function callColppyAPI<T>(
  payload: any,
  timeoutMs = 30000,
  opts: { throwOnEstadoError?: boolean } = {}
): Promise<T> {
  const { throwOnEstadoError = true } = opts;
  const operacion = `${payload?.service?.provision ?? '?'}/${payload?.service?.operacion ?? '?'}`;

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(COLPPY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: any) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new Error(`Timeout en llamada a Colppy: ${error.message}`);
      }
      throw new Error(`Error en llamada a Colppy: ${error.message}`);
    }

    // 1) Rate limit: esperar y reintentar ANTES de cualquier otro chequeo.
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;

      if (attempt >= RATE_LIMIT_MAX_RETRIES) {
        console.warn(
          `[Colppy] 429 rate limit en ${operacion} — se agotaron los ${RATE_LIMIT_MAX_RETRIES} reintentos`
        );
        throw new ColppyRateLimitError();
      }

      const waitMs =
        Number.isFinite(retryAfterSec) && retryAfterSec >= 0
          ? (retryAfterSec + 1) * 1000
          : RATE_LIMIT_BACKOFF_MS[Math.min(attempt, RATE_LIMIT_BACKOFF_MS.length - 1)];

      console.warn(
        `[Colppy] 429 rate limit en ${operacion} — reintento ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES} en ${waitMs}ms (Retry-After: ${retryAfterHeader ?? 'ausente'})`
      );
      await colppySleep(waitMs);
      continue;
    }

    const responseText = await response.text();
    const trimmed = responseText.trim();

    // 2) Respuesta HTML (sesión expirada → página de login)
    if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
      logger.error(`[Colppy] Respuesta HTML detectada (${trimmed.length} bytes). Sesión probablemente expirada.`);
      throw new ColppySessionExpiredError(trimmed);
    }

    // Verificar respuesta vacía
    if (!trimmed) {
      throw new ColppySessionExpiredError('Respuesta vacía de Colppy');
    }

    // Parsear respuesta JSON
    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error: any) {
      logger.error(`[Colppy] Respuesta no-JSON: ${error.message}`);
      throw new ColppySessionExpiredError(error.message);
    }

    // 3) Verificar si hay error en la respuesta
    if (throwOnEstadoError && parsed.result && parsed.result.estado !== 0) {
      // Mismo formato de mensaje que la versión anterior (que envolvía en el catch)
      throw new Error(`Error en llamada a Colppy: ${parsed.result.mensaje || 'Error desconocido de Colppy'}`);
    }

    return parsed;
  }
}

// ============================================================================
// AUTENTICACIÓN
// ============================================================================

/**
 * Inicia sesión en Colppy y obtiene claveSesion
 */
// ── Sesión cacheada en memoria (module scope) ──────────────────────────────
// Evita un login + logout contra Colppy por cada facturación. Mismo TTL de
// 20 min que usan los caches de sesión de api/colppy/* y colppy-inventory.
// No se hace logout de la sesión cacheada: se reutiliza hasta vencer y el
// retry ante ColppySessionExpiredError la renueva si Colppy la invalidó antes.
let cachedColppySession: { session: ColppySession; expiresAt: number } | null = null
const COLPPY_SESSION_TTL_MS = 20 * 60 * 1000

export function invalidateColppySessionCache(): void {
  cachedColppySession = null
}

export async function getCachedColppySession(): Promise<ColppySession> {
  if (cachedColppySession && cachedColppySession.expiresAt > Date.now()) {
    return cachedColppySession.session
  }
  const session = await colppyLogin()
  cachedColppySession = { session, expiresAt: Date.now() + COLPPY_SESSION_TTL_MS }
  return session
}

export async function colppyLogin(): Promise<ColppySession> {
  const config = getColppyConfig();
  const passwordMD5 = md5Hash(config.password);

  const payload = {
    auth: {
      usuario: config.user,
      password: passwordMD5,
    },
    service: {
      provision: 'Usuario',
      operacion: 'iniciar_sesion',
    },
    parameters: {
      usuario: config.user,
      password: passwordMD5,
    },
  };

  try {
    const response = await callColppyAPI<any>(payload);

    if (!response.response?.data?.claveSesion) {
      throw new Error('Colppy no retornó claveSesion');
    }

    return {
      claveSesion: response.response.data.claveSesion,
      usuario: config.user,
      idEmpresa: config.idEmpresa,
    };
  } catch (error: any) {
    throw new Error(`Error al iniciar sesión en Colppy: ${error.message}`);
  }
}

/**
 * Cierra sesión en Colppy
 */
export async function colppyLogout(session: ColppySession): Promise<void> {
  const config = getColppyConfig();
  const passwordMD5 = md5Hash(config.password);

  const payload = {
    auth: {
      usuario: config.user,
      password: passwordMD5,
    },
    service: {
      provision: 'Usuario',
      operacion: 'cerrar_sesion',
    },
    parameters: {
      sesion: {
        usuario: session.usuario,
        claveSesion: session.claveSesion,
      },
    },
  };

  try {
    await callColppyAPI(payload);
  } catch (error: any) {
    // No lanzar error si falla logout, solo loguear
    logger.warn(`Advertencia al cerrar sesión en Colppy: ${error.message}`);
  }
}

// ============================================================================
// CLIENTES
// ============================================================================

/**
 * Normaliza un CUIT al formato de Colppy: XX-XXXXXXXX-X
 */
function formatCuit(cuit: string): string {
  // Sacar todo lo que no sea número
  const nums = cuit.replace(/\D/g, '');
  if (nums.length === 11) {
    return nums.slice(0, 2) + '-' + nums.slice(2, 10) + '-' + nums.slice(10);
  }
  return cuit; // devolver tal cual si no tiene 11 dígitos
}

/**
 * Formatea una fecha al formato de Colppy: DD-MM-YYYY
 */
function formatDateColppy(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Mapea el ID numérico de condición de pago al texto que espera Colppy
 */
function mapCondicionPago(id: string | null | undefined): string {
  const map: Record<string, string> = {
    "0": "Contado",
    "7": "a 7 Dias",
    "15": "a 15 Dias",
    "30": "a 30 Dias",
    "45": "a 45 Dias",
    "60": "a 60 Dias",
    "90": "a 90 Dias",
    "120": "a 120 Dias",
  };
  return map[id || "0"] || "Contado";
}

/**
 * Busca un cliente en Colppy por CUIT
 */
export async function colppyFindCustomerByCUIT(
  session: ColppySession,
  cuit: string
): Promise<ColppyCustomer | null> {
  const config = getColppyConfig();
  const passwordMD5 = md5Hash(config.password);

  // Formatear CUIT con guiones para coincidir con formato de Colppy: XX-XXXXXXXX-X
  const cuitFormatted = formatCuit(cuit);

  const payload = {
    auth: {
      usuario: config.user,
      password: passwordMD5,
    },
    service: {
      provision: 'Cliente',
      operacion: 'listar_cliente',
    },
    parameters: {
      sesion: {
        usuario: session.usuario,
        claveSesion: session.claveSesion,
      },
      idEmpresa: session.idEmpresa,
      start: 0,
      limit: 50,
      filter: [
        {
          field: 'CUIT',
          op: '=',
          value: cuitFormatted,
        },
      ],
      order: [{ field: 'NombreFantasia', dir: 'asc' }],
    },
  };

  try {
    const response = await callColppyAPI<any>(payload);

    if (!response.response?.data || response.response.data.length === 0) {
      return null;
    }

    const cliente = response.response.data[0];

    // === DIAGNÓSTICO: Log de todos los campos del cliente de Colppy ===
    logger.info('=== CAMPOS DEL CLIENTE EN COLPPY ===');
    logger.info(JSON.stringify(cliente, null, 2));
    logger.info('=== FIN CAMPOS CLIENTE ===');

    // Intentar múltiples nombres posibles para la condición de pago
    const idCondicionPago = cliente.idCondicionPago
      || cliente.IdCondicionPago
      || cliente.condicionPago
      || cliente.CondicionPago
      || cliente.condPago
      || cliente.PaymentTerms
      || cliente.paymentTerms
      || cliente.idCondPago
      || '0';

    return {
      idEntidad: cliente.idCliente || cliente.id,
      razonSocial: cliente.RazonSocial || cliente.NombreFantasia,
      cuit: cliente.CUIT,
      condicionIva: cliente.CondicionIVA || 'RESPONSABLE_INSCRIPTO',
      idCondicionPago: String(idCondicionPago),
    };
  } catch (error: any) {
    throw new Error(`Error al buscar cliente en Colppy: ${error.message}`);
  }
}

/**
 * Crea un nuevo cliente en Colppy
 */
export async function colppyCreateCustomer(
  session: ColppySession,
  customer: {
    razonSocial: string;
    cuit: string;
    condicionIva: string;
    direccion?: string;
    telefono?: string;
    email?: string;
  }
): Promise<ColppyCustomer> {
  const config = getColppyConfig();
  const passwordMD5 = md5Hash(config.password);

  // Formatear CUIT con guiones para coincidir con formato de Colppy: XX-XXXXXXXX-X
  const cuitFormatted = formatCuit(customer.cuit);

  // Mapear condición IVA a formato Colppy
  const condicionIvaMap: Record<string, string> = {
    RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
    MONOTRIBUTO: 'Monotributo',
    EXENTO: 'Exento',
    CONSUMIDOR_FINAL: 'Consumidor Final',
    NO_RESPONSABLE: 'No Responsable',
    RESPONSABLE_NO_INSCRIPTO: 'Responsable No Inscripto',
  };

  const payload = {
    auth: {
      usuario: config.user,
      password: passwordMD5,
    },
    service: {
      provision: 'Cliente',
      operacion: 'alta_cliente',
    },
    parameters: {
      sesion: {
        usuario: session.usuario,
        claveSesion: session.claveSesion,
      },
      idEmpresa: session.idEmpresa,
      RazonSocial: customer.razonSocial,
      NombreFantasia: customer.razonSocial,
      CUIT: cuitFormatted,
      CondicionIVA: condicionIvaMap[customer.condicionIva] || 'Responsable Inscripto',
      Direccion: customer.direccion || '',
      Telefono: customer.telefono || '',
      Email: customer.email || '',
    },
  };

  try {
    const response = await callColppyAPI<any>(payload);

    // Verificar si la operación fue exitosa
    if (response.response?.success === false) {
      throw new Error(`Error de Colppy: ${response.response?.message || 'Error desconocido'}`);
    }

    // Extraer idcliente (minúscula) de la respuesta
    const idCliente = response.response?.idcliente || response.response?.idCliente;

    if (!idCliente) {
      throw new Error('Colppy no retornó idcliente en la respuesta');
    }

    return {
      idEntidad: idCliente,
      razonSocial: customer.razonSocial,
      cuit: customer.cuit,
      condicionIva: customer.condicionIva,
    };
  } catch (error: any) {
    throw new Error(`Error al crear cliente en Colppy: ${error.message}`);
  }
}

// ============================================================================
// INVENTARIO
// ============================================================================

/**
 * Busca un item de inventario en Colppy por SKU
 * Retorna el idItem si lo encuentra, "0" si no existe
 */
export async function getColppyItemId(
  session: ColppySession,
  sku: string
): Promise<string> {
  const config = getColppyConfig();
  const passwordMD5 = md5Hash(config.password);

  const payload = {
    auth: {
      usuario: config.user,
      password: passwordMD5,
    },
    service: {
      provision: 'Inventario',
      operacion: 'listar_itemsinventario',
    },
    parameters: {
      sesion: {
        usuario: session.usuario,
        claveSesion: session.claveSesion,
      },
      idEmpresa: session.idEmpresa,
      start: 0,
      limit: 1,
      filter: [
        {
          field: 'codigo',
          op: '=',
          value: sku,
        },
      ],
      order: [{ field: 'codigo', dir: 'asc' }],
    },
  };

  try {
    const response = await callColppyAPI<any>(payload);

    if (response.response?.data && response.response.data.length > 0) {
      return String(response.response.data[0].idItem || '0');
    }

    return '0'; // Si no existe en Colppy, item manual
  } catch (error: any) {
    logger.warn(`No se pudo buscar item ${sku} en Colppy:`, error.message);
    return '0'; // En caso de error, retornar "0" para item manual
  }
}

// ============================================================================
// REMITOS
// ============================================================================

/**
 * Crea un remito en Colppy
 */
export async function colppyCreateDeliveryNote(
  session: ColppySession,
  deliveryNote: {
    idCliente: string;
    fecha: string; // YYYY-MM-DD
    items: Array<{
      descripcion: string;
      cantidad: number;
      precioUnitario: number;
    }>;
  }
): Promise<{ idRemito: string; numeroRemito: string }> {
  const config = getColppyConfig();
  const passwordMD5 = md5Hash(config.password);

  const payload = {
    auth: {
      usuario: config.user,
      password: passwordMD5,
    },
    service: {
      provision: 'Remito',
      operacion: 'alta_remito',
    },
    parameters: {
      sesion: {
        usuario: session.usuario,
        claveSesion: session.claveSesion,
      },
      idEmpresa: session.idEmpresa,
      idCliente: deliveryNote.idCliente,
      Fecha: deliveryNote.fecha,
      Items: deliveryNote.items.map((item) => ({
        Descripcion: item.descripcion,
        Cantidad: item.cantidad,
        PrecioUnitario: item.precioUnitario,
      })),
    },
  };

  logger.info('=== PAYLOAD REMITO COLPPY ===');
  logger.info(JSON.stringify(payload, null, 2));
  logger.info('=== FIN PAYLOAD ===');

  try {
    const response = await callColppyAPI<any>(payload);

    logger.info('=== RESPUESTA COLPPY REMITO ===');
    logger.info(JSON.stringify(response, null, 2));
    logger.info('=== FIN RESPUESTA ===');

    // Verificar si la operación fue exitosa
    if (response.response?.success === false) {
      throw new Error(`Error de Colppy: ${response.response?.message || 'Error desconocido'}`);
    }

    // Extraer idremito (minúscula) de la respuesta
    const idRemito = response.response?.idremito || response.response?.idRemito;
    const numeroRemito = response.response?.nroRemito || response.response?.NumeroRemito;

    if (!idRemito) {
      throw new Error('Colppy no retornó idremito en la respuesta');
    }

    return {
      idRemito: String(idRemito),
      numeroRemito: numeroRemito || idRemito,
    };
  } catch (error: any) {
    throw new Error(`Error al crear remito en Colppy: ${error.message}`);
  }
}

// ============================================================================
// FACTURAS
// ============================================================================

/**
 * Crea una factura en Colppy
 */
/**
 * Mapea condición de pago del cliente (días) a formato texto de Colppy
 */
function mapPaymentTerms(paymentTerms: string | number | null | undefined): string {
  if (!paymentTerms || paymentTerms === '0' || paymentTerms === 0) {
    return 'Contado';
  }

  const terms = String(paymentTerms);
  const daysMap: Record<string, string> = {
    '7': 'a 7 Dias',
    '15': 'a 15 Dias',
    '30': 'a 30 Dias',
    '45': 'a 45 Dias',
    '60': 'a 60 Dias',
    '90': 'a 90 Dias',
  };

  return daysMap[terms] || 'Contado';
}

export type ColppyInvoicePayload = {
    descripcion: string; // Ej: "Cotización VAL-2026-005"
    idCliente: string;
    puntoVenta?: string; // Punto de venta (ej: "0003")
    fechaFactura: string; // YYYY-MM-DD
    fechaVto: string; // YYYY-MM-DD
    tipoFactura: 'A' | 'B' | 'C' | 'E' | 'I' | 'M' | 'T' | 'X' | 'Z';
    idCondicionPago: string; // "Contado", "a 7 Dias", "a 30 Dias", etc.
    moneda: string; // "Dolar estadounidense"
    tipoCambio: string; // Tipo de cambio (ej: "1400")
    currency?: string; // "USD" o "ARS" — para campos idCurrency/idMoneda/rate
    exchangeRate?: number | null; // TC de la cotización para facturas en USD
    netoGravado: number;
    netoNoGravado: number;
    totalIVA: number;
    totalFactura: number;
    /**
     * Estado inicial. 'Borrador' (default): Colppy la emite después.
     * 'Aprobada': factura YA emitida afuera (ARCA desde el ERP); Colppy la toma
     * como comprobante no electrónico con el número dado y genera asiento/CC/stock.
     */
    estado?: 'Borrador' | 'Aprobada';
    /** Número real (solo con estado Aprobada): sucursal 4 dígitos y número 8 dígitos. */
    nroFactura1?: string;
    nroFactura2?: string;
    /** Clase de comprobante (default FACTURA). Define idTipoComprobante segun la letra. */
    claseComprobante?: 'FACTURA' | 'NOTA_CREDITO' | 'NOTA_DEBITO';
    items: Array<{
      // Estructura alineada al ejemplo oficial del soporte de Colppy:
      // numéricos como number, subtotal en vez de importeTotal/importeIva,
      // IVA=0 (el IVA real va discriminado en totalesiva raíz).
      idItem: number;
      minimo?: string;
      tipoItem?: string;
      codigo?: string;
      Descripcion: string;
      ImporteUnitario: number;
      subtotal: number;
      IVA: number;
      Cantidad: number;
      unidadMedida?: string;
      Comentario?: string;
      porcDesc?: number;
      idPlanCuenta?: string;
      ccosto1?: string;
      ccosto2?: string;
      almacen?: string;
      editable?: boolean;
    }>;
};

export function colppyTipoComprobante(
  clase: 'FACTURA' | 'NOTA_CREDITO' | 'NOTA_DEBITO',
  tipoFactura: string
): string {
  // Comportamiento probado: las facturas B se vienen cargando con '4' (la letra
  // la define idTipoFactura) y Colppy las toma bien. Se mantiene el mismo
  // criterio para NC/ND: 5 = NCV, 8 = NDV.
  // Segun el propio mensaje de validacion de la API (alta_facturaventa):
  // "4 para Factura, 6 para ND, 8 para Factura Contado, NCV para Nota de
  // Credito de venta y 9 para Nota de credito compra".
  void tipoFactura;
  if (clase === 'NOTA_CREDITO') return 'NCV';
  if (clase === 'NOTA_DEBITO') return '6';
  return '4';
}

export async function colppyCreateInvoice(
  session: ColppySession,
  invoice: ColppyInvoicePayload
): Promise<{ idFactura: string; numeroFactura: string }> {
  const config = getColppyConfig();
  const passwordMD5 = md5Hash(config.password);

  const estado = invoice.estado || 'Borrador';
  // Borrador: número provisorio (Colppy asigna el definitivo al emitir).
  // Aprobada: número real del comprobante emitido por el ERP.
  const nroFactura1 = invoice.nroFactura1 || invoice.puntoVenta || '0003'; // Punto de venta
  const nroFactura2 = invoice.nroFactura2 || String(Date.now()).slice(-8); // Últimos 8 dígitos del timestamp
  if (estado === 'Aprobada' && (!invoice.nroFactura1 || !invoice.nroFactura2)) {
    throw new Error('colppyCreateInvoice: una factura Aprobada requiere nroFactura1 y nroFactura2 reales');
  }

  const payload = {
    auth: {
      usuario: config.user,
      password: passwordMD5,
    },
    service: {
      provision: 'FacturaVenta',
      operacion: 'alta_facturaventa',
    },
    parameters: {
      sesion: {
        usuario: session.usuario,
        claveSesion: session.claveSesion,
      },
      idEmpresa: session.idEmpresa,
      idFactura: '',
      idEstadoAnterior: '',
      idUsuario: session.usuario,
      descripcion: invoice.descripcion,
      idCliente: invoice.idCliente,
      // Borrador (flujo clásico: Colppy emite) o Aprobada (emitida por el ERP vía ARCA).
      // Sin `labelfe: 'Factura Electrónica'`: para Colppy es un comprobante no
      // electrónico y no intenta pedir CAE.
      idEstadoFactura: estado,
      idTipoFactura: invoice.tipoFactura,
      // 4 = Factura, NCV = Nota de Credito, 6 = Nota de Debito (la letra va en idTipoFactura)
      idTipoComprobante: colppyTipoComprobante(invoice.claseComprobante || 'FACTURA', invoice.tipoFactura),
      nroFactura1: nroFactura1,
      nroFactura2: nroFactura2,
      fechaFactura: invoice.fechaFactura,
      fechaVto: invoice.fechaVto,
      // Colppy interpreta fechaPago como la fecha de vencimiento. Si acá
      // mandamos fechaFactura, el vencimiento termina siendo el mismo día
      // de emisión, ignorando la condición de pago del cliente.
      fechaPago: invoice.fechaVto,
      idCondicionPago: invoice.idCondicionPago,
      orderId: '',
      nroRepeticion: '1',
      periodoRep: '1',
      nroVencimiento: '',
      tipoVencimiento: '1',
      fechaFin: '',
      moneda: invoice.moneda,
      tipoCambio: invoice.tipoCambio,
      // Campos de moneda extranjera (requeridos por Colppy para USD).
      // El bug "netoGravado=0.00 en UI" apareció en 668c5f0 al introducir
      // estos campos. Pruebas F1-F6 eliminando campos individuales no
      // resolvieron. El ejemplo oficial del soporte de Colppy muestra
      // diferencias fundamentales (tipos number vs string, subtotal en
      // items, extra_data en raíz, IVA=0 en items, etc.) — se alinea
      // con él.
      idCurrency: invoice.currency === 'USD' ? '1' : '0',
      idMoneda: invoice.currency === 'USD' ? '1' : '0',
      rate: invoice.currency === 'USD' ? String(Number(invoice.exchangeRate) || 1) : '1',
      valorCambio: '1',
      isFront: '0',
      price_list_id: '',
      // Campos adicionales de factura
      cbu: '',
      is_fce: '0',
      transmision_fce: '',
      codigoActividad: '',
      codigoOperacion: '',
      extra_data: '',
      // Totales en la RAÍZ como NUMBER (según ejemplo oficial de Colppy).
      // Cambio vs versión anterior: antes íban como string "X.XX" — ahora
      // number crudo redondeado a 2 decimales.
      netoGravado: Math.round(Number(invoice.netoGravado) * 100) / 100,
      netoNoGravado: Math.round(Number(invoice.netoNoGravado) * 100) / 100,
      totalIVA: Math.round(Number(invoice.totalIVA) * 100) / 100,
      // IVA21/IVA105/IVA27 van como string vacío según ejemplo oficial
      // (no como valor discriminado; el detalle va en totalesiva).
      IVA21: '',
      IVA105: '',
      IVA27: '',
      percepcionIVA: 0,
      percepcionIIBB: 0,
      totalFactura: Math.round(Number(invoice.totalFactura) * 100) / 100,
      labelfe: '',
      totalesiva: [
        { alicuotaIva: '0',    importeIva: 0, baseImpIva: 0 },
        { alicuotaIva: '2.5',  importeIva: 0, baseImpIva: 0 },
        { alicuotaIva: '5',    importeIva: 0, baseImpIva: 0 },
        { alicuotaIva: '10.5', importeIva: 0, baseImpIva: 0 },
        { alicuotaIva: '17.1', importeIva: 0, baseImpIva: 0 },
        {
          alicuotaIva: '21',
          importeIva: Math.round(Number(invoice.totalIVA) * 100) / 100,
          baseImpIva: Math.round(Number(invoice.netoGravado) * 100) / 100,
        },
        { alicuotaIva: '27',   importeIva: 0, baseImpIva: 0 },
      ],
      itemsFactura: invoice.items,
    },
  };

  try {
    const response = await callColppyAPI<any>(payload);

    // Verificar si la operación fue exitosa
    if (response.response?.success === false) {
      throw new Error(`Error de Colppy: ${response.response?.message || 'Error desconocido'}`);
    }

    // Extraer idfactura (minúscula) de la respuesta
    const idFactura = response.response?.idfactura || response.response?.idFactura;
    const numeroFactura = response.response?.nroFactura || `${nroFactura1}-${nroFactura2}`;

    if (!idFactura) {
      throw new Error('Colppy no retornó idfactura en la respuesta');
    }

    return {
      idFactura: String(idFactura),
      numeroFactura: numeroFactura,
    };
  } catch (error: any) {
    logger.error('[Colppy] colppyCreateInvoice error:', error?.message || String(error));
    // Detectar error específico de "importe unitario negativo"
    const errorMsg = error.message || String(error);
    if (errorMsg.toLowerCase().includes('importe unitario negativo') ||
        errorMsg.toLowerCase().includes('negative') ||
        errorMsg.toLowerCase().includes('precio')) {
      throw new Error(
        'Error de precios en Colppy: Los items tienen importes negativos. ' +
        'Esto suele ocurrir cuando los precios de venta en Colppy están desactualizados. ' +
        'Por favor, actualice los precios de venta de los productos en Colppy e intente nuevamente.'
      );
    }
    throw new Error(`Error al crear factura en Colppy: ${errorMsg}`);
  }
}

// ============================================================================
// PROVEEDORES
// ============================================================================

/**
 * Busca un proveedor en Colppy por CUIT
 */
export async function colppyFindSupplierByCUIT(
  session: ColppySession,
  cuit: string
): Promise<{ idProveedor: string; razonSocial: string } | null> {
  const config = getColppyConfig();
  const passwordMD5 = md5Hash(config.password);
  const cuitFormatted = formatCuit(cuit);

  const payload = {
    auth: {
      usuario: config.user,
      password: passwordMD5,
    },
    service: {
      provision: 'Proveedor',
      operacion: 'listar_proveedor',
    },
    parameters: {
      sesion: {
        usuario: session.usuario,
        claveSesion: session.claveSesion,
      },
      idEmpresa: session.idEmpresa,
      start: 0,
      limit: 50,
      filter: [
        {
          field: 'CUIT',
          op: '=',
          value: cuitFormatted,
        },
      ],
      order: [{ field: 'RazonSocial', dir: 'asc' }],
    },
  };

  try {
    const response = await callColppyAPI<any>(payload);

    if (!response.response?.data || response.response.data.length === 0) {
      return null;
    }

    const proveedor = response.response.data[0];
    logger.info('[Colppy] Proveedor encontrado:', JSON.stringify(proveedor, null, 2));

    return {
      idProveedor: String(proveedor.idProveedor || proveedor.id),
      razonSocial: proveedor.RazonSocial || proveedor.NombreFantasia || '',
    };
  } catch (error: any) {
    throw new Error(`Error al buscar proveedor en Colppy: ${error.message}`);
  }
}

// ============================================================================
// FACTURAS DE COMPRA
// ============================================================================

export interface ColppyPurchaseInvoiceParams {
  idProveedor: string;
  descripcion: string;
  fechaFactura: string; // DD-MM-YYYY
  fechaFacturaDoc: string; // DD-MM-YYYY (fecha del documento)
  fechaPago: string; // DD-MM-YYYY (vencimiento)
  idTipoFactura: 'A' | 'B' | 'C' | 'E' | 'M' | 'X' | 'Z';
  idTipoComprobante: string; // "1" = Factura
  idCondicionPago: string; // "Contado", "a 30 Dias", etc.
  idEstadoFactura: string; // "Aprobada", "Borrador"
  nroFactura1: string; // Punto de venta (4 dígitos: "0031")
  nroFactura2: string; // Número (8 dígitos: "00294187")
  netoGravado: string;
  netoNoGravado: string;
  totalIVA: string;
  IVA21: string;
  IVA105: string;
  IVA27: string;
  percepcionIVA: string;
  percepcionIIBB: number; // Suma total IIBB como NÚMERO (no string)
  percsufridas?: Array<{
    jurisdiccion: string; // Nombre exacto Colppy: "Buenos Aires", "CABA", etc.
    nroCertificado: string;
    importePerc: number; // Monto como NÚMERO
  }>;
  totalFactura: string;
  idMoneda?: string; // "1" = Peso argentino
  valorCambio?: string; // Tipo de cambio
  idRetGanancias?: string; // Código retención ganancias (ej: "78")
  itemsFactura: Array<{
    idItem?: string; // ID del item en inventario Colppy (vincula código automáticamente)
    Descripcion: string;
    unidadMedida: string; // "Un", "m", "kg"
    Cantidad: string;
    ImporteUnitario: string;
    IVA: string; // "21.00", "10.50", "27.00"
    idPlanCuenta: string; // "Mercaderias" o nombre de cuenta contable
    codigo?: string; // Código del producto
    almacen?: string;
    porcDesc?: string; // Descuento %
  }>;
}

/**
 * Crea una factura de compra en Colppy
 * Usa provision: 'FacturaCompra', operacion: 'alta_facturacompra'
 */
export async function colppyCreatePurchaseInvoice(
  session: ColppySession,
  invoice: ColppyPurchaseInvoiceParams
): Promise<{ idFactura: string }> {
  const config = getColppyConfig();
  const passwordMD5 = md5Hash(config.password);

  // Valores válidos de condición de pago para Colppy
  const VALID_PAYMENT_TERMS = [
    'Contado', 'a 7 Dias', 'a 15 Dias', 'a 30 Dias', 'a 45 Dias',
    'a 60 Dias', 'a 90 Dias', 'a 120 Dias', 'a 150 Dias', 'a 180 Dias',
  ];
  const VALID_DAYS = [7, 15, 30, 45, 60, 90, 120, 150, 180];

  // Normalizar condición de pago — safety net para cualquier valor que llegue
  let normalizedCondicionPago = invoice.idCondicionPago || 'Contado';
  if (!VALID_PAYMENT_TERMS.includes(normalizedCondicionPago)) {
    // Intentar extraer días del texto
    const daysMatch = normalizedCondicionPago.match(/(\d+)/);
    if (daysMatch) {
      const dias = parseInt(daysMatch[1]);
      const closest = VALID_DAYS.reduce((prev, curr) =>
        Math.abs(curr - dias) < Math.abs(prev - dias) ? curr : prev
      );
      normalizedCondicionPago = `a ${closest} Dias`;
    } else if (normalizedCondicionPago.toLowerCase().includes('contado') || normalizedCondicionPago.toLowerCase().includes('efectivo')) {
      normalizedCondicionPago = 'Contado';
    } else {
      normalizedCondicionPago = 'a 30 Dias'; // Default seguro
    }
  }

  logger.info(`[Colppy FC] idCondicionPago original: "${invoice.idCondicionPago}" → normalizado: "${normalizedCondicionPago}"`);

  const payload = {
    auth: {
      usuario: config.user,
      password: passwordMD5,
    },
    service: {
      provision: 'FacturaCompra',
      operacion: 'alta_facturacompra',
    },
    parameters: {
      sesion: {
        usuario: session.usuario,
        claveSesion: session.claveSesion,
      },
      idEmpresa: session.idEmpresa,
      idProveedor: invoice.idProveedor,
      idFactura: '', // Vacío para alta
      descripcion: invoice.descripcion.substring(0, 100), // Max 100 chars
      fechaFactura: invoice.fechaFactura,
      fechaFacturaDoc: invoice.fechaFacturaDoc,
      fechaPago: invoice.fechaPago,
      idTipoFactura: invoice.idTipoFactura,
      idTipoComprobante: invoice.idTipoComprobante,
      idCondicionPago: normalizedCondicionPago,
      idEstadoFactura: invoice.idEstadoFactura,
      idMoneda: invoice.idMoneda || '1', // 1 = Peso argentino
      valorCambio: invoice.valorCambio || '1',
      nroFactura1: invoice.nroFactura1,
      nroFactura2: invoice.nroFactura2,
      netoGravado: invoice.netoGravado,
      netoNoGravado: invoice.netoNoGravado,
      totalIVA: invoice.totalIVA,
      IVA21: invoice.IVA21,
      IVA105: invoice.IVA105,
      IVA27: invoice.IVA27,
      percepcionIVA: invoice.percepcionIVA,
      percepcionIIBB: invoice.percepcionIIBB, // Número: suma total IIBB
      ...(invoice.percsufridas && invoice.percsufridas.length > 0
        ? { percsufridas: invoice.percsufridas }
        : {}),
      totalFactura: invoice.totalFactura,
      idRetGanancias: invoice.idRetGanancias || '',
      itemsFactura: invoice.itemsFactura,
    },
  };

  logger.info('=== PAYLOAD FACTURA COMPRA COLPPY ===');
  logger.info(JSON.stringify(payload, null, 2));
  logger.info('=== FIN PAYLOAD ===');

  try {
    const response = await callColppyAPI<any>(payload);

    logger.info('=== RESPUESTA COLPPY FACTURA COMPRA ===');
    logger.info(JSON.stringify(response, null, 2));
    logger.info('=== FIN RESPUESTA ===');

    if (response.response?.success === false) {
      throw new Error(`Error de Colppy: ${response.response?.message || 'Error desconocido'}`);
    }

    const idFactura = response.response?.idFactura
      || response.response?.idfactura
      || response.response?.data?.idFactura;

    if (!idFactura) {
      // Algunos endpoints devuelven éxito sin ID explícito
      logger.warn('[Colppy] No se recibió idFactura, pero la operación pudo haber sido exitosa');
      return { idFactura: `colppy-${Date.now()}` };
    }

    return { idFactura: String(idFactura) };
  } catch (error: any) {
    throw new Error(`Error al crear factura de compra en Colppy: ${error.message}`);
  }
}

// ============================================================================
// HELPERS: Descomponer precio combinado en principal + adicionales
// ============================================================================

/** Calcula el precio de un componente aplicando descuento de marca y multiplicador */
export function calcComponentPrice(listPrice: number, brandDiscount: number, multiplier: number): number {
  return listPrice * (1 - brandDiscount) * multiplier;
}

/**
 * Construye un item con precios separados: principal + cada adicional con su propio precio.
 * QuoteItem.unitPrice INCLUYE adicionales, así que se descompone usando listPrice y brandDiscount.
 * Si el usuario editó el precio combinado en el dialog, se escala proporcionalmente.
 */
export function buildSplitItem(
  originalItem: {
    product?: { name: string; sku: string } | null;
    description?: string | null;
    manualSku?: string | null;
    quantity: number;
    listPrice: any;
    brandDiscount: any;
    customerMultiplier: any;
    unitPrice: any;
    deliveryTime?: string | null;
    additionals: Array<{
      product?: { name: string; sku: string } | null;
      description?: string | null;
      listPrice: any;
    }>;
  },
  calcPrice: typeof calcComponentPrice,
  quote: { quoteNumber: string; notes?: string | null },
  overrides?: { descripcion?: string; sku?: string; cantidad?: number; precioUnitario?: number; iva?: number; comentario?: string },
) {
  const brandDiscount = Number(originalItem.brandDiscount) || 0;
  const customerMultiplier = Number(originalItem.customerMultiplier) || 1;
  const mainListPrice = Number(originalItem.listPrice);

  // Precio calculado solo del producto principal
  const mainPrice = calcPrice(mainListPrice, brandDiscount, customerMultiplier);

  // Precios calculados de cada adicional
  const addPrices = originalItem.additionals.map((add) =>
    calcPrice(Number(add.listPrice), brandDiscount, customerMultiplier)
  );

  // Total original (debería coincidir con QuoteItem.unitPrice)
  const originalTotal = mainPrice + addPrices.reduce((s, p) => s + p, 0);

  // Si el usuario editó el precio combinado, escalar proporcionalmente
  const editedTotal = overrides?.precioUnitario ?? Number(originalItem.unitPrice);
  const scaleFactor = originalTotal > 0 ? editedTotal / originalTotal : 1;

  const productName = overrides?.descripcion || originalItem.product?.name || originalItem.description || 'Item manual';
  const productSku = overrides?.sku || originalItem.product?.sku || originalItem.manualSku || '';
  const quantity = overrides?.cantidad ?? originalItem.quantity;
  const iva = overrides?.iva ?? 21;
  const comentario = overrides?.comentario || `Cotización ${quote.quoteNumber}${quote.notes ? ' / ' + quote.notes : ''}`;

  const additionals = originalItem.additionals.map((add, idx) => {
    const name = add.product?.name || add.description || 'Adicional manual';
    logger.info(`[buildSplitItem] Adicional ${idx}: product?.name="${add.product?.name}", description="${add.description}", sku="${add.product?.sku}" → name="${name}"`);
    return {
      name,
      unitPrice: Math.round(addPrices[idx] * scaleFactor * 100) / 100,
      sku: add.product?.sku || '',
    };
  });

  logger.info(`[buildSplitItem] productName="${productName}", productSku="${productSku}", additionals=${additionals.length}`);

  return {
    productName,
    productSku,
    quantity,
    unitPrice: Math.round(mainPrice * scaleFactor * 100) / 100,
    iva,
    comentario,
    deliveryTime: originalItem.deliveryTime || undefined,
    additionals,
  };
}

/**
 * Tipo mínimo de un "split item" (salida de buildSplitItem o equivalente):
 * principal en unitPrice + adicionales en additionals[], todos YA redondeados.
 */
type SplitItemAmounts = {
  unitPrice: number
  quantity: number
  additionals?: Array<{ unitPrice: number }>
}

/**
 * Precio unitario combinado de una línea = principal + Σ adicionales, usando los
 * MISMOS valores ya redondeados a 2 decimales que se mandan a Colppy.
 *
 * Es la única fuente de verdad del "precio de la línea": coincide exactamente con
 * lo que Colppy/AFIP reconstruye facturando cada componente como línea separada.
 * Ej. VAL-2026-1160: 38,96 + 31,59 + 75,53 + 15,75 = 161,83 (NO 161,84, que era el
 * combinado sin redondear por componente).
 */
export function splitItemUnitTotal(item: Pick<SplitItemAmounts, 'unitPrice' | 'additionals'>): number {
  const adds = (item.additionals || []).reduce((s, a) => s + a.unitPrice, 0)
  return Math.round((item.unitPrice + adds) * 100) / 100
}

/**
 * Total de una línea = precio unitario combinado × cantidad. Igual a la suma de
 * las líneas (principal + adicionales) que factura Colppy, porque cada componente
 * es 2 decimales y la cantidad es entera. Ej. VAL-2026-1160 (5 u): 161,83 × 5 = 809,15.
 *
 * `qty` opcional permite usar una cantidad distinta a item.quantity (p. ej. cuando
 * se persiste solo lo pendiente).
 */
export function splitItemLineTotal(item: SplitItemAmounts, qty?: number): number {
  const cantidad = qty ?? item.quantity
  return Math.round(splitItemUnitTotal(item) * cantidad * 100) / 100
}

// ============================================================================
// FUNCIÓN WRAPPER DE ALTO NIVEL
// ============================================================================

/**
 * Envía una cotización a Colppy (remito, factura, o ambos)
 * Esta es la función principal que se usa desde el endpoint API
 */
export async function sendQuoteToColppy(
  options: SendToColppyOptions,
  quote: {
    id: string;
    quoteNumber: string;
    currency: string;
    exchangeRate: number | null;
    // Bonificación global de cabecera en % (ej. 3). Si falta/undefined, se trata como 0.
    bonification?: number | null;
    // Si true, los unitPrice de los items YA incluyen IVA 21% (Factura B).
    // Si false, son netos y se suma IVA aparte (Factura A).
    // Cuando está indefinido caemos al comportamiento legacy basado en taxCondition.
    pricesIncludeTax?: boolean;
    customer: {
      name: string;
      cuit: string;
      taxCondition: string;
      address?: string;
      phone?: string;
      email?: string;
    };
    items: Array<{
      productName: string;
      productSku: string;
      quantity: number;
      unitPrice: number;
      iva?: number;
      comentario?: string;
      deliveryTime?: string;
      additionals?: Array<{
        name: string;
        unitPrice: number;
        sku: string;
      }>;
    }>;
  }
): Promise<SendToColppyResult> {
  let session: ColppySession | null = null;
  let emisionRealizada: EmisionExternaResultado | null = null;
  let payloadEnviado: ColppyInvoicePayload | null = null;

  /**
   * Helper: ejecuta una función con la sesión actual.
   * Si falla por sesión expirada, re-autentica y reintenta UNA vez.
   */
  async function withRetry<T>(fn: (s: ColppySession) => Promise<T>): Promise<T> {
    try {
      return await fn(session!);
    } catch (error: any) {
      if (error instanceof ColppySessionExpiredError) {
        logger.info('[Colppy] Sesión expirada, re-autenticando...');
        invalidateColppySessionCache();
        session = await getCachedColppySession();
        return await fn(session);
      }
      throw error;
    }
  }

  try {
    // 1. Sesión cacheada (antes: login + logout contra Colppy en cada envío)
    session = await getCachedColppySession();

    // 2. Buscar o crear cliente (con retry automático ante sesión expirada)
    let customer = await withRetry((s) => colppyFindCustomerByCUIT(s, quote.customer.cuit));

    if (!customer) {
      customer = await withRetry((s) => colppyCreateCustomer(s, {
        razonSocial: quote.customer.name,
        cuit: quote.customer.cuit,
        condicionIva: quote.customer.taxCondition,
        direccion: quote.customer.address,
        telefono: quote.customer.phone,
        email: quote.customer.email,
      }));
    }

    // 3. Preparar items (los precios van en USD tal cual)
    const exchangeRate = quote.currency === 'USD' ? quote.exchangeRate || 1 : 1;

    // Bonificación global de cabecera (%). Se aplica como descuento por línea
    // (porcDesc) + factor sobre el neto del header, para que la reconstrucción
    // de Colppy (ImporteUnitario × Cantidad × (1 − porcDesc/100)) cuadre con la
    // cabecera. Si bonification === 0, bonifFactor === 1 → comportamiento idéntico.
    const bonifFactor = 1 - Number(quote.bonification ?? 0) / 100;

    const preparedItems = quote.items.flatMap((item) => {
      // Item principal: usa SU PROPIO productName
      const mainItem = {
        descripcion: item.productName,
        cantidad: item.quantity,
        precioUnitario: item.unitPrice,
        productSku: item.productSku,
        ivaPercent: item.iva || 21,
        comentario: item.comentario,
      };

      // Adicionales como items separados: cada uno con SU PROPIA descripción
      // (nombre del producto adicional, NO el del producto principal)
      const additionalItems = (item.additionals || []).map((additional) => ({
        descripcion: additional.name,
        cantidad: item.quantity,
        precioUnitario: additional.unitPrice,
        productSku: additional.sku,
        ivaPercent: item.iva || 21,
        comentario: item.comentario,
      }));

      return [mainItem, ...additionalItems];
    });

    logger.info(`[Colppy] preparedItems (${preparedItems.length} líneas):`, JSON.stringify(preparedItems.map(p => ({
      sku: p.productSku,
      desc: p.descripcion,
      cant: p.cantidad,
      precio: p.precioUnitario,
    })), null, 2));

    // 4. Determinar tipo de factura según condición IVA
    const tipoFactura: 'A' | 'B' =
      quote.customer.taxCondition === 'RESPONSABLE_INSCRIPTO' ? 'A' : 'B';

    // 5. Preparar items con IVA según tipo de factura.
    //
    //    Factura A (Responsable Inscripto):
    //      - ImporteUnitario es el NETO (sin IVA). Se discrimina el IVA 21%
    //        aparte en importeIva/totalIVA.
    //      - Si la cotización tiene pricesIncludeTax=true, los unitPrice guardados
    //        ya traen IVA → hay que dividir por 1.21 para obtener el neto.
    //
    //    Factura B (Consumidor Final / Monotributo / Exento):
    //      - ImporteUnitario es el precio FINAL (con IVA incluido). Colppy se
    //        encarga internamente de la discriminación del IVA para ARCA.
    //      - Por lo tanto, NUNCA dividimos por 1.21 para Factura B: el precio se
    //        manda tal cual. Si pricesIncludeTax=false (precio neto), se manda
    //        igual como ImporteUnitario y Colppy le suma el IVA; si es true,
    //        también se manda tal cual (ya es el final).
    //
    //    Nota: el antiguo bug de sub-facturación venía de dividir por 1.21 en
    //    Factura B, lo que bajaba el total final.
    const pricesIncludeTax =
      typeof quote.pricesIncludeTax === 'boolean'
        ? quote.pricesIncludeTax
        : tipoFactura === 'B';

    const itemsConIVA = preparedItems.map((item) => {
      let precioUnitario = item.precioUnitario;
      let iva = 0;

      if (tipoFactura === 'A') {
        // Factura A: ImporteUnitario = neto. Si la cotización viene con IVA
        // incluido, lo sacamos dividiendo por 1.21.
        if (pricesIncludeTax) {
          precioUnitario = precioUnitario / 1.21;
        }
        iva = precioUnitario * 0.21;
      } else {
        // Factura B: ImporteUnitario se manda con IVA incluido (precio final).
        // Pero el IVA discriminado sí se calcula (gross / 1.21 * 0.21) para
        // que Colppy no tenga que recalcular los totales al abrir la factura.
        const neto = precioUnitario / 1.21;
        iva = neto * 0.21;
      }

      return {
        ...item,
        precioUnitario,
        iva,
      };
    });

    // 6. Fecha actual en formato DD-MM-YYYY
    const fecha = formatDateColppy(new Date());

    // 7. Ejecutar acciones según opción seleccionada
    const result: SendToColppyResult = {
      success: true,
      customerPaymentTermsDays: parseInt(customer.idCondicionPago || '0') || 0,
    };

    if (options.action === 'remito' || options.action === 'remito-factura') {
      const remito = await withRetry((s) => colppyCreateDeliveryNote(s, {
        idCliente: customer.idEntidad,
        fecha,
        items: preparedItems,
      }));

      result.remitoId = remito.idRemito;
      result.remitoNumber = remito.numeroRemito;
    }

    if (
      options.action === 'factura-cuenta-corriente' ||
      options.action === 'factura-contado' ||
      options.action === 'remito-factura'
    ) {
      // Fecha actual en formato DD-MM-YYYY
      const fechaFactura = formatDateColppy(new Date());

      // Obtener condición de pago (de options si está, si no del cliente)
      const idCondicionPago = options.condicionPago || mapCondicionPago(customer.idCondicionPago || '0');

      // Calcular días de vencimiento desde la condición de pago
      // Soporta tanto texto ("a 30 Dias") como numérico ("30")
      const condicionPagoMap: Record<string, number> = {
        'Contado': 7,       // +7 días para que no aparezca vencida al emitir
        'a 7 Dias': 7,
        'a 15 Dias': 15,
        'a 30 Dias': 30,
        'a 45 Dias': 45,
        'a 60 Dias': 60,
        'a 90 Dias': 90,
        'a 120 Dias': 120,
        // Fallback con claves numéricas por si llega el ID en vez del texto
        '0': 7,
        '7': 7,
        '15': 15,
        '30': 30,
        '45': 45,
        '60': 60,
        '90': 90,
        '120': 120,
      };

      // ?? para que 0 (Contado) no se trate como falsy y caiga al fallback.
      const parsedCustomerDays = parseInt(customer.idCondicionPago || '')
      const diasVto =
        condicionPagoMap[idCondicionPago] ??
        (Number.isFinite(parsedCustomerDays) ? parsedCustomerDays : 0)

      // Calcular fecha de vencimiento
      const fechaVtoDate = new Date();
      fechaVtoDate.setDate(fechaVtoDate.getDate() + diasVto);
      const fechaVto = formatDateColppy(fechaVtoDate);

      // Buscar idItem de Colppy para cada producto por SKU (incluye adicionales).
      // Primero desde la DB local (Product.colppyItemId, sincronizado desde el
      // inventario de Colppy): antes esto era una llamada a Colppy POR CADA SKU.
      // Solo va a Colppy para los SKUs sin mapeo local (manuales o sin sync).
      const colppyItemIds: Record<string, string> = {};
      const skusFactura = Array.from(
        new Set(
          preparedItems
            .map((i) => i.productSku)
            .filter((s): s is string => !!s)
        )
      );
      if (skusFactura.length > 0) {
        const localProducts = await prisma.product.findMany({
          where: { sku: { in: skusFactura }, colppyItemId: { not: null } },
          select: { sku: true, colppyItemId: true },
        });
        for (const p of localProducts) {
          colppyItemIds[p.sku] = String(p.colppyItemId);
        }
        for (const sku of skusFactura) {
          if (!colppyItemIds[sku]) {
            colppyItemIds[sku] = await withRetry((s) => getColppyItemId(s, sku));
          }
        }
      }

      // Calcular totales para Colppy
      // Cada preparedItem tiene su propio SKU, IVA% y comentario (tanto principales como adicionales)
      let netoGravado = 0;
      const itemsFactura = itemsConIVA.map((item, index) => {
        const prepItem = preparedItems[index]; // Índices alineados: preparedItems → itemsConIVA

        // Convertir a números (pueden venir como strings de los inputs).
        // Factura A: importeUnitario es NETO, se suma tal cual al netoGravado.
        // Factura B: importeUnitario es GROSS (con IVA); el neto que va al
        // netoGravado root es importeUnitario / 1.21.
        const cantidad = Number(item.cantidad);
        const importeUnitario = Number(item.precioUnitario);
        const ivaPorUnidad = Number(item.iva);
        const importeTotal = importeUnitario * cantidad;
        const importeIva = ivaPorUnidad * cantidad;

        const netoLinea =
          tipoFactura === 'A'
            ? importeTotal
            : (importeUnitario / 1.21) * cantidad;
        netoGravado += netoLinea;

        // Estructura según ejemplo oficial del soporte de Colppy:
        // - Todos los numéricos como NUMBER (no string).
        // - IVA=21 (number) en el item: Colppy usa este valor para
        //   clasificar la línea como "Neto gravado" (alícuota 21%). Con
        //   IVA=0 lo clasificaba como "Neto no gravado".
        // - subtotal = importeUnitario*cantidad (mismo valor que la línea sin IVA).
        // - unidadMedida "Un" (Unidades). Catálogo de VAL ARG vende por unidad;
        //   si en el futuro aparecen productos por kg/m/l habrá que mapearlo
        //   desde Product.unit. Mandar "" hace que Colppy muestre la columna
        //   "U. Medida" vacía en la factura.
        // - Sin importeTotal ni importeIva (no aparecen en el ejemplo).
        const subtotalLinea = Math.round(importeTotal * 100) / 100;
        return {
          idItem: Number(colppyItemIds[prepItem.productSku]) || 0,
          minimo: '',
          tipoItem: '',
          codigo: '',
          Descripcion: item.descripcion,
          ImporteUnitario: Math.round(importeUnitario * 100) / 100,
          subtotal: Math.round(subtotalLinea * bonifFactor * 100) / 100,
          IVA: 21,
          Cantidad: cantidad,
          unidadMedida: 'Un',
          Comentario: prepItem.comentario || `Cotización ${quote.quoteNumber}`,
          porcDesc: Number(quote.bonification),
          idPlanCuenta: 'Ventas',
          ccosto1: '',
          ccosto2: '',
          almacen: '',
          editable: false,
        };
      });

      // Redondear a 2 decimales para evitar floating point issues.
      // En ambos tipos el netoGravado (raíz) representa el neto real; el IVA
      // 21% se discrimina aparte. Así Colppy recibe todos los totales
      // consistentes y no necesita "apretar TAB" para recalcular.
      netoGravado = Math.round(netoGravado * bonifFactor * 100) / 100;
      const totalIVA = Math.round(netoGravado * 0.21 * 100) / 100;
      const totalFactura = Math.round((netoGravado + totalIVA) * 100) / 100;

      // Guard defensivo: nunca mandar NaN/null o totales no positivos a Colppy
      // (Colppy devolvería un mensaje críptico tipo "El totalFactura no puede ser
      // negativo o nulo"). Mejor fallar acá con un error claro y trazable.
      if (
        !Number.isFinite(netoGravado) || netoGravado <= 0 ||
        !Number.isFinite(totalIVA) || totalIVA <= 0 ||
        !Number.isFinite(totalFactura) || totalFactura <= 0
      ) {
        throw new Error(
          `Total inválido al armar factura Colppy: netoGravado=${netoGravado}, ` +
          `totalIVA=${totalIVA}, totalFactura=${totalFactura} ` +
          `(quote ${quote.quoteNumber}, bonification=${quote.bonification})`
        );
      }

      const facturaPayload: ColppyInvoicePayload = {
        descripcion: options.descripcion || `Cotización ${quote.quoteNumber}`,
        idCliente: customer.idEntidad,
        puntoVenta: options.puntoVenta,
        fechaFactura: fechaFactura,
        fechaVto: fechaVto,
        tipoFactura: tipoFactura,
        idCondicionPago: idCondicionPago,
        moneda: quote.currency === 'USD' ? 'Dolar estadounidense' : 'Peso argentino',
        tipoCambio: quote.currency === 'USD' ? String(exchangeRate) : '1',
        currency: quote.currency,
        exchangeRate: quote.exchangeRate,
        netoGravado: Math.round(netoGravado * 100) / 100,
        netoNoGravado: 0,
        totalIVA: Math.round(totalIVA * 100) / 100,
        totalFactura: Math.round(totalFactura * 100) / 100,
        items: itemsFactura,
      };

      // Emisión externa (ARCA desde el ERP): pedir CAE con EXACTAMENTE los
      // totales que va a recibir Colppy, y cargar la factura ya emitida como
      // Aprobada con su número real. Si ARCA rechaza, el hook lanza y no se
      // toca Colppy.
      if (options.emisionExterna) {
        const emision = await options.emisionExterna({
          tipoFactura,
          netoGravado: facturaPayload.netoGravado,
          totalIVA: facturaPayload.totalIVA,
          totalFactura: facturaPayload.totalFactura,
          currency: quote.currency,
          exchangeRate: quote.currency === 'USD' ? exchangeRate : null,
          fechaFactura: new Date(),
          fechaVto: fechaVtoDate,
          idCondicionPago,
          descripcion: facturaPayload.descripcion,
        });
        result.emision = emision;
        emisionRealizada = emision;
        facturaPayload.estado = 'Aprobada';
        // Al entrar directamente como Aprobada (sin pasar por la pantalla de
        // Colppy) hay que decirle explícitamente que la línea es un producto de
        // inventario y de qué depósito sale; si no, no mueve stock ni genera
        // las líneas de costo (Mercaderías / CMV) del asiento.
        const almacen = process.env.COLPPY_ALMACEN || '';
        for (let i = 0; i < facturaPayload.items.length; i++) {
          const it = facturaPayload.items[i];
          const prep = preparedItems[i];
          if (it.idItem && it.idItem !== 0) {
            it.tipoItem = 'P';
            it.codigo = prep?.productSku || it.codigo || '';
            it.almacen = almacen;
          }
        }
        facturaPayload.nroFactura1 = String(emision.puntoVenta).padStart(4, '0');
        facturaPayload.nroFactura2 = String(emision.numero).padStart(8, '0');
        facturaPayload.descripcion = `${facturaPayload.descripcion} - CAE ${emision.cae}`.slice(0, 100);
        result.colppyInvoicePayload = facturaPayload;
        payloadEnviado = facturaPayload;
      }

      console.log('=== PAYLOAD VENTA COLPPY ===', JSON.stringify(facturaPayload, null, 2));

      const factura = await withRetry((s) => colppyCreateInvoice(s, facturaPayload));

      result.facturaId = factura.idFactura;
      result.facturaNumber = result.emision?.numeroFormateado || factura.numeroFactura;
    }

    logger.info('[Colppy] sendQuoteToColppy OK', {
      remitoId: result.remitoId,
      remitoNumber: result.remitoNumber,
      facturaId: result.facturaId,
      facturaNumber: result.facturaNumber,
    });
    return result;
  } catch (error: any) {
    // Importante: este catch devolvía {success:false, error} sin loguear,
    // por lo que cualquier error interno quedaba invisible en pm2.
    logger.error('[Colppy] sendQuoteToColppy error:', error?.message || String(error), error?.stack);
    const stage: 'arca' | 'colppy' = error instanceof EmisionExternaError || error?.stage === 'arca' ? 'arca' : 'colppy';
    return {
      success: false,
      error: error.message,
      errorStage: stage,
      // Si ARCA ya autorizó y falló Colppy después, el llamador necesita el CAE
      // y el payload para persistir la factura y reintentar el alta en Colppy.
      emision: emisionRealizada ?? undefined,
      colppyInvoicePayload: payloadEnviado ?? undefined,
    };
  }
  // Nota: no se hace logout — la sesión queda cacheada para el próximo envío
  // (ver getCachedColppySession). El logout bloqueaba la respuesta al usuario
  // después de que la factura ya estaba emitida.
}

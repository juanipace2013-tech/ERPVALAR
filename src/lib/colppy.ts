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

export interface SendToColppyOptions {
  action: 'remito' | 'factura-cuenta-corriente' | 'factura-contado' | 'remito-factura';
  condicionPago?: string;
  puntoVenta?: string;
  descripcion?: string;
}

export interface SendToColppyResult {
  success: boolean;
  remitoId?: string;
  remitoNumber?: string;
  facturaId?: string;
  facturaNumber?: string;
  error?: string;
  customerPaymentTermsDays?: number; // Días de pago del cliente en Colppy, para sincronizar a DB local
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
 * Realiza una llamada a la API de Colppy usando fetch() nativo.
 * Detecta respuestas HTML (sesión expirada) y lanza ColppySessionExpiredError.
 *
 * Migrado desde execSync(curl) para mayor confiabilidad:
 * - Sin archivos temporales
 * - Sin bloqueo del event loop
 * - Sin límites de tamaño de comando
 * - Manejo correcto de redirects
 */
export async function callColppyAPI<T>(payload: any, timeoutMs = 30000): Promise<T> {
  try {
    const response = await fetch(COLPPY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });

    const responseText = await response.text();
    const trimmed = responseText.trim();

    // Verificar si la respuesta es HTML (sesión expirada → página de login)
    if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
      logger.error(`[Colppy] Respuesta HTML detectada (${trimmed.length} bytes). Sesión probablemente expirada.`);
      throw new ColppySessionExpiredError(trimmed);
    }

    // Verificar respuesta vacía
    if (!trimmed) {
      throw new ColppySessionExpiredError('Respuesta vacía de Colppy');
    }

    // Parsear respuesta JSON
    const parsed = JSON.parse(trimmed);

    // Verificar si hay error en la respuesta
    if (parsed.result && parsed.result.estado !== 0) {
      throw new Error(parsed.result.mensaje || 'Error desconocido de Colppy');
    }

    return parsed;
  } catch (error: any) {
    // Re-lanzar ColppySessionExpiredError sin envolver
    if (error instanceof ColppySessionExpiredError) {
      throw error;
    }
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error(`Timeout en llamada a Colppy: ${error.message}`);
    }
    if (error.message?.includes('JSON') || error.message?.includes('Unexpected')) {
      logger.error(`[Colppy] Respuesta no-JSON: ${error.message}`);
      throw new ColppySessionExpiredError(error.message);
    }
    throw new Error(`Error en llamada a Colppy: ${error.message}`);
  }
}

// ============================================================================
// AUTENTICACIÓN
// ============================================================================

/**
 * Inicia sesión en Colppy y obtiene claveSesion
 */
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

export async function colppyCreateInvoice(
  session: ColppySession,
  invoice: {
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
    netoGravado: string;
    netoNoGravado: string;
    exento: string;
    totalIVA: string;
    IVA21: string;
    IVA105: string;
    IVA27: string;
    noGravado: string;
    percepIVA: string;
    percepIIBB: string;
    impInterno: string;
    totalFactura: string;
    items: Array<{
      idItem: string; // idItem de Colppy o "0" para servicios
      tipoItem: 'P' | 'S'; // P=Producto, S=Servicio
      Descripcion: string;
      ImporteUnitario?: string;
      importeUnitario?: string;
      importeTotal: string;
      importeIva: string;
      IVA: string; // "21.00"
      Cantidad: string;
      unidadMedida?: string; // "Un", "m", "kg", etc.
      Comentario?: string; // Comentario del item
      porcDesc?: string;
      idPlanCuenta?: string;
    }>;
  }
): Promise<{ idFactura: string; numeroFactura: string }> {
  const config = getColppyConfig();
  const passwordMD5 = md5Hash(config.password);

  // Generar número de factura con timestamp
  const nroFactura1 = invoice.puntoVenta || '0003'; // Punto de venta
  const nroFactura2 = String(Date.now()).slice(-8); // Últimos 8 dígitos del timestamp

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
      descripcion: invoice.descripcion,
      idCliente: invoice.idCliente,
      idEstadoFactura: 'Borrador', // SIEMPRE crear como borrador
      idTipoFactura: invoice.tipoFactura,
      idTipoComprobante: '4', // 4=Factura
      nroFactura1: nroFactura1,
      nroFactura2: nroFactura2,
      fechaFactura: invoice.fechaFactura,
      fechaVto: invoice.fechaVto,
      idCondicionPago: invoice.idCondicionPago,
      moneda: invoice.moneda,
      tipoCambio: invoice.tipoCambio,
      // Campos de moneda extranjera (requeridos por Colppy para USD)
      idCurrency: invoice.currency === 'USD' ? '1' : '0',
      idMoneda: invoice.currency === 'USD' ? '1' : '0',
      rate: invoice.currency === 'USD' ? String(Number(invoice.exchangeRate) || 1) : '1',
      valorCambio: '1',
      not_api: '0',
      isFront: '0',
      // Campos adicionales de factura
      cbu: '',
      is_fce: '0',
      transmision_fce: '',
      codigoActividad: '',
      codigoOperacion: '',
      netoGravado: String(Math.round(Number(invoice.netoGravado) * 100) / 100),
      netoNoGravado: invoice.netoNoGravado,
      exento: invoice.exento,
      totalIVA: String(Math.round(Number(invoice.totalIVA) * 100) / 100),
      IVA21: String(Math.round(Number(invoice.IVA21) * 100) / 100),
      IVA105: invoice.IVA105,
      IVA27: invoice.IVA27,
      noGravado: invoice.noGravado,
      percepIVA: invoice.percepIVA,
      percepIIBB: invoice.percepIIBB,
      impInterno: invoice.impInterno,
      totalFactura: String(Math.round(Number(invoice.totalFactura) * 100) / 100),
      itemsFactura: invoice.items,
    },
  };

  logger.info('=== PAYLOAD FACTURA COLPPY ===');
  logger.info(`[Colppy Factura] Moneda: currency=${invoice.currency}, idCurrency=${payload.parameters.idCurrency}, idMoneda=${payload.parameters.idMoneda}, rate=${payload.parameters.rate}, not_api=${payload.parameters.not_api}`);
  logger.info(JSON.stringify(payload, null, 2));
  logger.info('=== FIN PAYLOAD ===');

  try {
    const response = await callColppyAPI<any>(payload);

    logger.info('=== RESPUESTA COLPPY FACTURA ===');
    logger.info(JSON.stringify(response, null, 2));
    logger.info('=== FIN RESPUESTA ===');

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
      unitPrice: Number((addPrices[idx] * scaleFactor).toFixed(2)),
      sku: add.product?.sku || '',
    };
  });

  logger.info(`[buildSplitItem] productName="${productName}", productSku="${productSku}", additionals=${additionals.length}`);

  return {
    productName,
    productSku,
    quantity,
    unitPrice: Number((mainPrice * scaleFactor).toFixed(2)),
    iva,
    comentario,
    deliveryTime: originalItem.deliveryTime || undefined,
    additionals,
  };
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
        session = await colppyLogin();
        return await fn(session);
      }
      throw error;
    }
  }

  try {
    // 1. Iniciar sesión
    session = await colppyLogin();

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

    // 5. Preparar items con IVA
    const itemsConIVA = preparedItems.map((item) => {
      let precioUnitario = item.precioUnitario;
      let iva = 0;

      if (tipoFactura === 'A') {
        // Factura A: precio sin IVA, se suma 21%
        iva = precioUnitario * 0.21;
      } else {
        // Factura B: precio incluye IVA, neto = precio / 1.21
        precioUnitario = precioUnitario / 1.21;
        iva = precioUnitario * 0.21;
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
        'Contado': 5,       // +5 días para dar tiempo al cliente
        'a 7 Dias': 7,
        'a 15 Dias': 15,
        'a 30 Dias': 30,
        'a 45 Dias': 45,
        'a 60 Dias': 60,
        'a 90 Dias': 90,
        'a 120 Dias': 120,
        // Fallback con claves numéricas por si llega el ID en vez del texto
        '0': 5,
        '7': 7,
        '15': 15,
        '30': 30,
        '45': 45,
        '60': 60,
        '90': 90,
        '120': 120,
      };

      // Usar ?? en vez de || para que 0 no sea tratado como falsy
      const diasVto = (condicionPagoMap[idCondicionPago]
        ?? parseInt(customer.idCondicionPago || '0'))
        || 5; // fallback mínimo de 5 días

      logger.info(`[Colppy Factura] condicionPago="${idCondicionPago}", diasVto=${diasVto}, customer.idCondicionPago="${customer.idCondicionPago}"`);

      // Calcular fecha de vencimiento
      const fechaVtoDate = new Date();
      fechaVtoDate.setDate(fechaVtoDate.getDate() + diasVto);
      const fechaVto = formatDateColppy(fechaVtoDate);

      // Buscar idItem de Colppy para cada producto por SKU (incluye adicionales)
      const colppyItemIds: Record<string, string> = {};
      for (const item of preparedItems) {
        if (item.productSku && !colppyItemIds[item.productSku]) {
          colppyItemIds[item.productSku] = await withRetry((s) => getColppyItemId(s, item.productSku));
        }
      }

      // Calcular totales para Colppy
      // Cada preparedItem tiene su propio SKU, IVA% y comentario (tanto principales como adicionales)
      let netoGravado = 0;
      const itemsFactura = itemsConIVA.map((item, index) => {
        const prepItem = preparedItems[index]; // Índices alineados: preparedItems → itemsConIVA

        // Convertir a números (pueden venir como strings de los inputs)
        const cantidad = Number(item.cantidad);
        const importeUnitario = Number(item.precioUnitario); // Ya está sin IVA para factura A, o neto para B
        const ivaRate = Number(item.iva);
        const importeTotal = importeUnitario * cantidad;
        const importeIva = ivaRate * cantidad;

        netoGravado += importeTotal;

        return {
          idItem: colppyItemIds[prepItem.productSku] || '0',
          tipoItem: 'P' as 'P', // P para productos
          Descripcion: item.descripcion,
          ImporteUnitario: String(Number(importeUnitario).toFixed(2)),
          importeTotal: String(Number(importeTotal).toFixed(2)),
          importeIva: String(Number(importeIva).toFixed(2)),
          IVA: String(Number(prepItem.ivaPercent).toFixed(2)),
          Cantidad: String(cantidad),
          unidadMedida: 'Un',
          Comentario: prepItem.comentario || `Cotización ${quote.quoteNumber}`,
          porcDesc: '0',
          idPlanCuenta: 'Ventas',
        };
      });

      // Redondear a 2 decimales para evitar floating point issues
      netoGravado = Math.round(netoGravado * 100) / 100;
      const totalIVA = Math.round(netoGravado * 0.21 * 100) / 100;
      const totalFactura = Math.round((netoGravado + totalIVA) * 100) / 100;

      // DEBUG TEMPORAL — ver valores en producción (console.error siempre aparece en logs)
      console.error('[COLPPY-DEBUG] totalFactura:', totalFactura, 'netoGravado:', netoGravado, 'totalIVA:', totalIVA, 'currency:', quote.currency);
      console.error('[COLPPY-DEBUG] items precios:', itemsConIVA.map((it, i) => ({
        i,
        desc: it.descripcion?.substring(0, 30),
        precioUnitario: it.precioUnitario,
        cantidad: it.cantidad,
        iva: it.iva,
      })));

      logger.info(`[Colppy Factura] fechaFactura="${fechaFactura}", fechaVto="${fechaVto}"`);
      logger.info(`[Colppy Factura] itemsFactura Descripcion:`, itemsFactura.map((i, idx) => ({
        idx,
        idItem: i.idItem,
        Descripcion: i.Descripcion,
        SKU: preparedItems[idx]?.productSku,
      })));

      const factura = await withRetry((s) => colppyCreateInvoice(s, {
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
        netoGravado: String(Number(netoGravado).toFixed(2)),
        netoNoGravado: '0',
        exento: '0',
        totalIVA: String(Number(totalIVA).toFixed(2)),
        IVA21: String(Number(totalIVA).toFixed(2)),
        IVA105: '0',
        IVA27: '0',
        noGravado: '0',
        percepIVA: '0',
        percepIIBB: '0',
        impInterno: '0',
        totalFactura: String(Number(totalFactura).toFixed(2)),
        items: itemsFactura,
      }));

      result.facturaId = factura.idFactura;
      result.facturaNumber = factura.numeroFactura;
    }

    return result;
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  } finally {
    // Siempre cerrar sesión
    if (session) {
      await colppyLogout(session);
    }
  }
}

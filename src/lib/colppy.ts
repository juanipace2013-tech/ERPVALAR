/**
 * Módulo de integración con la API de Colppy
 * Sistema contable para automatizar la creación de remitos y facturas
 *
 * IMPORTANTE: Colppy requiere estructura específica:
 * - auth: { usuario, password (MD5) }
 * - service: { provision, operacion }
 * - parameters: { sesion: { usuario, claveSesion }, ...params }
 */

import { execSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
}

// ============================================================================
// LLAMADA A API DE COLPPY
// ============================================================================

/**
 * Realiza una llamada a la API de Colppy usando curl
 * Usamos curl en lugar de axios/fetch debido a problemas con redirects
 * Usa archivo temporal para evitar problemas de escape en bash/cmd
 */
function callColppyAPI<T>(payload: any): T {
  let tempFile: string | null = null;

  try {
    // Crear archivo temporal para el payload
    tempFile = path.join(os.tmpdir(), `colppy-${Date.now()}.json`);
    const payloadStr = JSON.stringify(payload);
    fs.writeFileSync(tempFile, payloadStr, 'utf-8');

    // Ejecutar curl usando el archivo temporal
    const cmd = `curl -s -X POST "${COLPPY_ENDPOINT}" -H "Content-Type: application/json" -d @"${tempFile}" --max-time 30 -L`;

    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 35000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    // Parsear respuesta JSON
    const parsed = JSON.parse(result);

    // Verificar si hay error en la respuesta
    if (parsed.result && parsed.result.estado !== 0) {
      throw new Error(parsed.result.mensaje || 'Error desconocido de Colppy');
    }

    return parsed;
  } catch (error: any) {
    if (error.message.includes('JSON') || error.message.includes('Unexpected')) {
      throw new Error(`Respuesta de Colppy no es JSON válido: ${error.message}`);
    }
    throw new Error(`Error en llamada a Colppy: ${error.message}`);
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
    const response = callColppyAPI<any>(payload);

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
    callColppyAPI(payload);
  } catch (error: any) {
    // No lanzar error si falla logout, solo loguear
    console.warn(`Advertencia al cerrar sesión en Colppy: ${error.message}`);
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
    const response = callColppyAPI<any>(payload);

    if (!response.response?.data || response.response.data.length === 0) {
      return null;
    }

    const cliente = response.response.data[0];

    return {
      idEntidad: cliente.idCliente || cliente.id,
      razonSocial: cliente.RazonSocial || cliente.NombreFantasia,
      cuit: cliente.CUIT,
      condicionIva: cliente.CondicionIVA || 'RESPONSABLE_INSCRIPTO',
      idCondicionPago: cliente.idCondicionPago || '0',
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
    const response = callColppyAPI<any>(payload);

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
    const response = callColppyAPI<any>(payload);

    if (response.response?.data && response.response.data.length > 0) {
      return String(response.response.data[0].idItem || '0');
    }

    return '0'; // Si no existe en Colppy, item manual
  } catch (error: any) {
    console.warn(`No se pudo buscar item ${sku} en Colppy:`, error.message);
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

  console.log('=== PAYLOAD REMITO COLPPY ===');
  console.log(JSON.stringify(payload, null, 2));
  console.log('=== FIN PAYLOAD ===');

  try {
    const response = callColppyAPI<any>(payload);

    console.log('=== RESPUESTA COLPPY REMITO ===');
    console.log(JSON.stringify(response, null, 2));
    console.log('=== FIN RESPUESTA ===');

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
      netoGravado: invoice.netoGravado,
      netoNoGravado: invoice.netoNoGravado,
      exento: invoice.exento,
      totalIVA: invoice.totalIVA,
      IVA21: invoice.IVA21,
      IVA105: invoice.IVA105,
      IVA27: invoice.IVA27,
      noGravado: invoice.noGravado,
      percepIVA: invoice.percepIVA,
      percepIIBB: invoice.percepIIBB,
      impInterno: invoice.impInterno,
      totalFactura: invoice.totalFactura,
      itemsFactura: invoice.items,
    },
  };

  console.log('=== PAYLOAD FACTURA COLPPY ===');
  console.log(JSON.stringify(payload, null, 2));
  console.log('=== FIN PAYLOAD ===');

  try {
    const response = callColppyAPI<any>(payload);

    console.log('=== RESPUESTA COLPPY FACTURA ===');
    console.log(JSON.stringify(response, null, 2));
    console.log('=== FIN RESPUESTA ===');

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
    notes?: string | null;
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
      }>;
    }>;
  }
): Promise<SendToColppyResult> {
  let session: ColppySession | null = null;

  try {
    // 1. Iniciar sesión
    session = await colppyLogin();

    // 2. Buscar o crear cliente
    let customer = await colppyFindCustomerByCUIT(session, quote.customer.cuit);

    if (!customer) {
      customer = await colppyCreateCustomer(session, {
        razonSocial: quote.customer.name,
        cuit: quote.customer.cuit,
        condicionIva: quote.customer.taxCondition,
        direccion: quote.customer.address,
        telefono: quote.customer.phone,
        email: quote.customer.email,
      });
    }

    // 3. Preparar items (los precios van en USD tal cual)
    const exchangeRate = quote.currency === 'USD' ? quote.exchangeRate || 1 : 1;

    const preparedItems = quote.items.flatMap((item) => {
      // Item principal
      const mainItem = {
        descripcion: item.productName,
        cantidad: item.quantity,
        precioUnitario: item.unitPrice,
      };

      // Adicionales como items separados
      const additionalItems = (item.additionals || []).map((additional) => ({
        descripcion: `${item.productName} - ${additional.name}`,
        cantidad: item.quantity,
        precioUnitario: additional.unitPrice,
      }));

      return [mainItem, ...additionalItems];
    });

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
    const result: SendToColppyResult = { success: true };

    if (options.action === 'remito' || options.action === 'remito-factura') {
      const remito = await colppyCreateDeliveryNote(session, {
        idCliente: customer.idEntidad,
        fecha,
        items: preparedItems,
      });

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
      const condicionPagoMap: Record<string, number> = {
        'Contado': 0,
        'a 7 Dias': 7,
        'a 15 Dias': 15,
        'a 30 Dias': 30,
        'a 45 Dias': 45,
        'a 60 Dias': 60,
        'a 90 Dias': 90,
        'a 120 Dias': 120,
      };
      const diasVto = condicionPagoMap[idCondicionPago] || parseInt(customer.idCondicionPago || '0');

      // Calcular fecha de vencimiento
      const fechaVtoDate = new Date();
      fechaVtoDate.setDate(fechaVtoDate.getDate() + diasVto);
      const fechaVto = formatDateColppy(fechaVtoDate);

      // Buscar idItem de Colppy para cada producto por SKU
      const colppyItemIds: Record<string, string> = {};
      for (const item of quote.items) {
        if (item.productSku && !colppyItemIds[item.productSku]) {
          colppyItemIds[item.productSku] = await getColppyItemId(session, item.productSku);
        }
      }

      // Calcular totales para Colppy
      let netoGravado = 0;
      const itemsFactura = itemsConIVA.map((item, index) => {
        const quoteItem = quote.items[Math.floor(index / (1 + (quote.items[0]?.additionals?.length || 0)))];

        // Convertir a números (pueden venir como strings de los inputs)
        const cantidad = Number(item.cantidad);
        const importeUnitario = Number(item.precioUnitario); // Ya está sin IVA para factura A, o neto para B
        const ivaRate = Number(item.iva);
        const importeTotal = importeUnitario * cantidad;
        const importeIva = ivaRate * cantidad;

        netoGravado += importeTotal;

        return {
          idItem: colppyItemIds[quoteItem?.productSku] || '0',
          tipoItem: 'P' as 'P', // P para productos
          Descripcion: item.descripcion,
          ImporteUnitario: String(Number(importeUnitario).toFixed(2)),
          importeTotal: String(Number(importeTotal).toFixed(2)),
          importeIva: String(Number(importeIva).toFixed(2)),
          IVA: String(Number(quoteItem?.iva || 21).toFixed(2)),
          Cantidad: String(cantidad),
          unidadMedida: 'Un',
          Comentario: quoteItem?.comentario || `Cotización ${quote.quoteNumber}${quote.notes ? ' / ' + quote.notes : ''}`,
          porcDesc: '0',
          idPlanCuenta: 'Ventas',
        };
      });

      const totalIVA = netoGravado * 0.21;
      const totalFactura = netoGravado + totalIVA;

      const factura = await colppyCreateInvoice(session, {
        descripcion: options.descripcion || `Cotización ${quote.quoteNumber}`,
        idCliente: customer.idEntidad,
        puntoVenta: options.puntoVenta,
        fechaFactura: fechaFactura,
        fechaVto: fechaVto,
        tipoFactura: tipoFactura,
        idCondicionPago: idCondicionPago,
        moneda: quote.currency === 'USD' ? 'Dolar estadounidense' : 'Peso argentino',
        tipoCambio: quote.currency === 'USD' ? String(exchangeRate) : '1',
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
      });

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
